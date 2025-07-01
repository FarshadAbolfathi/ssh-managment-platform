const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { dbConfig, JWT_SECRET, USER_TIERS } = require('./config');
const sshManager = require('./services/ssh-manager');
const panelInstaller = require('./services/installer');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Initialize database
async function initDatabase() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // Create users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        tier ENUM('free', 'premium', 'enterprise') DEFAULT 'free',
        tier_expires_at DATETIME NULL,
        api_key VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY idx_email (email(191)),
        UNIQUE KEY idx_api_key (api_key(191))
      )
    `);

    // Create installations table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS installations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        server_ip VARCHAR(45) NOT NULL,
        server_name VARCHAR(255),
        ssh_port INT DEFAULT 22,
        panel_path VARCHAR(255) DEFAULT '/var/www/html/panel',
        panel_username VARCHAR(100),
        panel_url VARCHAR(255),
        status ENUM('pending', 'installing', 'completed', 'failed') DEFAULT 'pending',
        install_key VARCHAR(255),
        install_progress INT DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        UNIQUE KEY idx_install_key (install_key(191))
      )
    `);

    // Create installation_logs table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS installation_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        installation_id INT,
        message TEXT,
        step VARCHAR(100),
        progress INT DEFAULT 0,
        status ENUM('info', 'success', 'error', 'warning') DEFAULT 'info',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE CASCADE,
        INDEX idx_installation_id (installation_id)
      )
    `);

    // Create payments table for future use
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        tier ENUM('premium', 'enterprise'),
        amount DECIMAL(10,2),
        currency VARCHAR(3) DEFAULT 'USD',
        payment_method VARCHAR(50),
        transaction_id VARCHAR(255),
        status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
        expires_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status)
      )
    `);

    await connection.end();
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Middleware for authentication
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access denied' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const connection = await mysql.createConnection(dbConfig);
    const [users] = await connection.execute('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    await connection.end();

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    req.user = users[0];
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Check tier limitations
const checkTierLimits = async (req, res, next) => {
  try {
    const user = req.user;
    const userTier = USER_TIERS[user.tier];
    
    const connection = await mysql.createConnection(dbConfig);
    const [installations] = await connection.execute(
      'SELECT COUNT(*) as count FROM installations WHERE user_id = ? AND status = "completed"',
      [user.id]
    );
    await connection.end();

    if (userTier.maxServers !== -1 && installations[0].count >= userTier.maxServers) {
      return res.status(403).json({ 
        success: false, 
        message: 'Server limit reached for your tier',
        upgrade_required: true 
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error checking limits' });
  }
};

// API Routes

// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const connection = await mysql.createConnection(dbConfig);
    
    // Check if user exists
    const [existingUsers] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      await connection.end();
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const apiKey = uuidv4();
    
    const [result] = await connection.execute(
      'INSERT INTO users (email, password, api_key) VALUES (?, ?, ?)',
      [email, hashedPassword, apiKey]
    );

    await connection.end();

    const token = jwt.sign({ userId: result.insertId }, JWT_SECRET, { expiresIn: '24h' });
    
    res.json({ 
      success: true, 
      token,
      user: {
        id: result.insertId,
        email,
        tier: 'free',
        api_key: apiKey
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const connection = await mysql.createConnection(dbConfig);
    const [users] = await connection.execute('SELECT * FROM users WHERE email = ?', [email]);
    await connection.end();

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    
    res.json({ 
      success: true, 
      token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        api_key: user.api_key
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Test SSH Connection
app.post('/api/test-connection', async (req, res) => {
  try {
    const serverData = req.body;
    await sshManager.connect(serverData);
    const result = await sshManager.executeCommand(serverData.serverIP, 'whoami');
    sshManager.disconnect(serverData.serverIP);

    if (result.code === 0) {
      res.json({
        success: true,
        message: 'Connection successful',
        user: result.stdout.trim()
      });
    } else {
      res.status(400).json({ success: false, message: `Connection failed: ${result.stderr}` });
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      message: `Connection failed: ${error.message}`
    });
  }
});

// Start Installation
app.post('/api/install', async (req, res) => {
  try {
    const { serverData, panelConfig } = req.body;
    const userId = 1; // Mock user ID for now
    
    // Validate input
    if (!serverData.serverIP || !serverData.sshUsername || !serverData.sshPassword) {
      return res.status(400).json({ success: false, message: 'Missing required server data' });
    }
    
    if (!panelConfig.panelUsername || !panelConfig.panelPassword) {
      return res.status(400).json({ success: false, message: 'Missing panel configuration' });
    }

    const connection = await mysql.createConnection(dbConfig);
    
    // Create installation record
    const installKey = uuidv4();
    const [result] = await connection.execute(
      `INSERT INTO installations (user_id, server_ip, server_name, ssh_port, panel_path, 
       panel_username, install_key, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        userId,
        serverData.serverIP,
        serverData.serverName || `Server ${serverData.serverIP}`,
        serverData.sshPort || 22,
        panelConfig.installPath || '/var/www/html/panel',
        panelConfig.panelUsername,
        installKey
      ]
    );

    await connection.end();
    
    const installationId = result.insertId;

    // Start installation process in background
    const installationData = {
      serverData,
      panelConfig,
      installationId
    };

    // Run installation asynchronously
    panelInstaller.install(installationData, 'free') // Mock tier for now
      .catch(error => {
        console.error('Installation error:', error);
      });

    res.json({ 
      success: true, 
      message: 'Installation started',
      installationId,
      installKey
    });
  } catch (error) {
    console.error('Install start error:', error);
    res.status(500).json({ success: false, message: 'Failed to start installation' });
  }
});

// Get Installation Status
app.get('/api/installation/:installKey', authenticate, async (req, res) => {
  try {
    const { installKey } = req.params;
    
    const connection = await mysql.createConnection(dbConfig);
    
    // Get installation details
    const [installations] = await connection.execute(
      'SELECT * FROM installations WHERE install_key = ? AND user_id = ?',
      [installKey, req.user.id]
    );

    if (installations.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: 'Installation not found' });
    }

    const installation = installations[0];

    // Get recent logs
    const [logs] = await connection.execute(
      'SELECT * FROM installation_logs WHERE installation_id = ? ORDER BY created_at DESC LIMIT 10',
      [installation.id]
    );

    await connection.end();

    res.json({
      success: true,
      installation: {
        id: installation.id,
        status: installation.status,
        progress: installation.install_progress,
        panel_url: installation.panel_url,
        error_message: installation.error_message,
        created_at: installation.created_at
      },
      logs: logs.map(log => ({
        message: log.message,
        status: log.status,
        progress: log.progress,
        created_at: log.created_at
      }))
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ success: false, message: 'Failed to get status' });
  }
});

// Get User Installations
app.get('/api/installations', authenticate, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    const [installations] = await connection.execute(
      'SELECT * FROM installations WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    await connection.end();

    res.json({
      success: true,
      installations: installations.map(inst => ({
        id: inst.id,
        server_ip: inst.server_ip,
        server_name: inst.server_name,
        status: inst.status,
        progress: inst.install_progress,
        panel_url: inst.panel_url,
        created_at: inst.created_at
      }))
    });
  } catch (error) {
    console.error('Get installations error:', error);
    res.status(500).json({ success: false, message: 'Failed to get installations' });
  }
});

// Get User Profile
app.get('/api/profile', authenticate, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    const [installations] = await connection.execute(
      'SELECT COUNT(*) as count FROM installations WHERE user_id = ? AND status = "completed"',
      [req.user.id]
    );

    await connection.end();

    const userTier = USER_TIERS[req.user.tier];
    
    res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        tier: req.user.tier,
        api_key: req.user.api_key,
        created_at: req.user.created_at
      },
      stats: {
        servers_used: installations[0].count,
        servers_limit: userTier.maxServers,
        features: userTier.features
      },
      tier_info: userTier
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

// Upgrade Tier (placeholder for payment integration)
app.post('/api/upgrade', authenticate, async (req, res) => {
  try {
    const { tier, payment_method } = req.body;
    
    if (!USER_TIERS[tier]) {
      return res.status(400).json({ success: false, message: 'Invalid tier' });
    }

    // Here you would integrate with payment processor (Stripe, PayPal, etc.)
    // For now, we'll just simulate the upgrade
    
    const connection = await mysql.createConnection(dbConfig);
    
    // Create payment record
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1); // 1 month from now
    
    await connection.execute(
      'INSERT INTO payments (user_id, tier, amount, payment_method, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, tier, USER_TIERS[tier].price, payment_method, 'completed', expiresAt]
    );

    // Update user tier
    await connection.execute(
      'UPDATE users SET tier = ?, tier_expires_at = ? WHERE id = ?',
      [tier, expiresAt, req.user.id]
    );

    await connection.end();

    res.json({
      success: true,
      message: 'Tier upgraded successfully',
      new_tier: tier,
      expires_at: expiresAt
    });
  } catch (error) {
    console.error('Upgrade error:', error);
    res.status(500).json({ success: false, message: 'Upgrade failed' });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initDatabase();
  console.log('📱 Panel installer ready!');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Server shutting down gracefully');
  // Close all SSH connections
  for (const [serverIP, ssh] of sshManager.connections) {
    ssh.dispose();
  }
  process.exit(0);
});