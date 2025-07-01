const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const sshManager = require('./ssh-manager');
const { USER_TIERS, dbConfig } = require('../config');

class PanelInstaller {
  constructor() {
    this.installationSteps = [
      { name: 'system_check', message: 'Checking system compatibility...', messageFA: 'بررسی سازگاری سیستم...', progress: 5 },
      { name: 'system_update', message: 'Updating system packages...', messageFA: 'بروزرسانی بسته‌های سیستم...', progress: 15 },
      { name: 'install_dependencies', message: 'Installing dependencies...', messageFA: 'نصب وابستگی‌ها...', progress: 30 },
      { name: 'setup_webserver', message: 'Setting up web server...', messageFA: 'راه‌اندازی وب سرور...', progress: 45 },
      { name: 'setup_database', message: 'Setting up database...', messageFA: 'راه‌اندازی پایگاه داده...', progress: 60 },
      { name: 'upload_files', message: 'Uploading panel files...', messageFA: 'آپلود فایل‌های پنل...', progress: 75 },
      { name: 'configure_panel', message: 'Configuring panel...', messageFA: 'پیکربندی پنل...', progress: 85 },
      { name: 'setup_permissions', message: 'Setting up permissions...', messageFA: 'تنظیم مجوزها...', progress: 95 },
      { name: 'finalize', message: 'Finalizing installation...', messageFA: 'تکمیل نصب...', progress: 100 }
    ];
  }

  async install(installationData, userTier = 'free') {
    const { serverData, panelConfig, installationId } = installationData;
    
    try {
      await this.updateInstallationStatus(installationId, 'installing');

      // Connect to server
      await sshManager.connect(serverData);
      await this.logStep(installationId, 'Connected to server', 'info', 2);

      // Execute installation steps
      for (const step of this.installationSteps) {
        await this.executeStep(step, serverData, panelConfig, installationId, userTier);
      }

      // Generate panel URL
      const panelUrl = `http://${serverData.serverIP}/panel`;
      await this.updateInstallationData(installationId, {
        status: 'completed',
        panel_url: panelUrl,
        install_progress: 100
      });

      return { 
        success: true, 
        message: 'Installation completed successfully',
        panelUrl: panelUrl
      };

    } catch (error) {
      await this.updateInstallationData(installationId, {
        status: 'failed',
        error_message: error.message
      });
      await this.logStep(installationId, `Installation failed: ${error.message}`, 'error', 0);
      throw error;
    } finally {
      sshManager.disconnect(serverData.serverIP);
    }
  }

  async executeStep(step, serverData, panelConfig, installationId, userTier) {
    await this.logStep(installationId, step.message, 'info', step.progress);
    await this.updateInstallationProgress(installationId, step.progress);

    const { serverIP } = serverData;
    const { panelUsername, panelPassword, installPath } = panelConfig;

    try {
      switch (step.name) {
        case 'system_check':
          await this.checkSystemCompatibility(serverIP);
          break;

        case 'system_update':
          await sshManager.executeCommand(serverIP, 'apt update');
          break;

        case 'install_dependencies':
          const dependencies = [
            'apache2',
            'php8.1',
            'php8.1-mysql',
            'php8.1-curl',
            'php8.1-json',
            'php8.1-mbstring',
            'php8.1-zip',
            'php8.1-gd',
            'mysql-server',
            'unzip',
            'curl',
            'wget'
          ].join(' ');
          await sshManager.executeCommand(serverIP, `DEBIAN_FRONTEND=noninteractive apt install -y ${dependencies}`);
          break;

        case 'setup_webserver':
          await sshManager.executeCommand(serverIP, 'systemctl enable apache2');
          await sshManager.executeCommand(serverIP, 'systemctl start apache2');
          await sshManager.executeCommand(serverIP, 'a2enmod rewrite');
          await sshManager.executeCommand(serverIP, 'systemctl reload apache2');
          break;

        case 'setup_database':
          const dbPassword = this.generateRandomPassword(16);
          const dbName = 'ssh_panel';
          const dbUser = 'sshpanel';
          
          // Setup MySQL
          await sshManager.executeCommand(serverIP, `mysql -e "CREATE DATABASE IF NOT EXISTS ${dbName};"`);
          await sshManager.executeCommand(serverIP, `mysql -e "CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}';"`);
          await sshManager.executeCommand(serverIP, `mysql -e "GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'localhost'; FLUSH PRIVILEGES;"`);
          break;

        case 'upload_files':
          await this.createAndUploadPanelFiles(serverIP, installPath, userTier);
          break;

        case 'configure_panel':
          await this.configurePanelSettings(serverIP, installPath, panelConfig, userTier);
          break;

        case 'setup_permissions':
          await sshManager.executeCommand(serverIP, `chown -R www-data:www-data ${installPath}`);
          await sshManager.executeCommand(serverIP, `chmod -R 755 ${installPath}`);
          await sshManager.executeCommand(serverIP, `chmod -R 775 ${installPath}/uploads`);
          break;

        case 'finalize':
          await this.finalizeInstallation(serverIP, installPath, panelConfig);
          break;
      }
    } catch (error) {
      throw new Error(`Step ${step.name} failed: ${error.message}`);
    }
  }

  async checkSystemCompatibility(serverIP) {
    const osInfo = await sshManager.executeCommand(serverIP, 'cat /etc/os-release');
    if (!osInfo.stdout.includes('Ubuntu') && !osInfo.stdout.includes('Debian')) {
      throw new Error('Unsupported operating system. Ubuntu or Debian required.');
    }
  }

  generateRandomPassword(length = 12) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  }

  async logStep(installationId, message, status = 'info', progress = 0) {
    try {
      const connection = await mysql.createConnection(dbConfig);
      await connection.execute(
        'INSERT INTO installation_logs (installation_id, message, progress, status) VALUES (?, ?, ?, ?)',
        [installationId, message, progress, status]
      );
      await connection.end();
    } catch (error) {
      console.error('Error logging step:', error);
    }
  }

  async updateInstallationStatus(installationId, status) {
    try {
      const connection = await mysql.createConnection(dbConfig);
      await connection.execute(
        'UPDATE installations SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, installationId]
      );
      await connection.end();
    } catch (error) {
      console.error('Error updating installation status:', error);
    }
  }

  async updateInstallationProgress(installationId, progress) {
    try {
      const connection = await mysql.createConnection(dbConfig);
      await connection.execute(
        'UPDATE installations SET install_progress = ? WHERE id = ?',
        [progress, installationId]
      );
      await connection.end();
    } catch (error) {
      console.error('Error updating installation progress:', error);
    }
  }

  async updateInstallationData(installationId, data) {
    try {
      const connection = await mysql.createConnection(dbConfig);
      const fields = Object.keys(data).map(key => `${key} = ?`).join(', ');
      const values = Object.values(data);
      values.push(installationId);
      
      await connection.execute(
        `UPDATE installations SET ${fields}, updated_at = NOW() WHERE id = ?`,
        values
      );
      await connection.end();
    } catch (error) {
      console.error('Error updating installation data:', error);
    }
  }

  async createAndUploadPanelFiles(serverIP, installPath, userTier) {
    // Create installation directory
    await sshManager.executeCommand(serverIP, `mkdir -p ${installPath}`);
    await sshManager.executeCommand(serverIP, `mkdir -p ${installPath}/uploads`);
    await sshManager.executeCommand(serverIP, `mkdir -p ${installPath}/backups`);
    
    // Create panel files based on user tier
    const panelFiles = this.generatePanelFiles(userTier);
    
    // Write files to temp directory and upload
    const tempDir = `/tmp/panel_${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });
    
    for (const [filename, content] of Object.entries(panelFiles)) {
      const filePath = path.join(tempDir, filename);
      fs.writeFileSync(filePath, content);
      await sshManager.uploadFile(serverIP, filePath, `${installPath}/${filename}`);
    }
    
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  generatePanelFiles(userTier) {
    const files = {};
    
    // Main index.php
    files['index.php'] = this.generateIndexPHP(userTier);
    
    // Configuration file
    files['config.php'] = this.generateConfigPHP();
    
    // Database schema
    files['install.sql'] = this.generateDatabaseSchema();
    
    // User management files
    files['users.php'] = this.generateUsersPHP(userTier);
    files['add_user.php'] = this.generateAddUserPHP(userTier);
    files['delete_user.php'] = this.generateDeleteUserPHP();
    
    // API endpoints
    files['api.php'] = this.generateAPIPHP(userTier);
    
    // Styles and scripts
    files['style.css'] = this.generateCSS();
    files['script.js'] = this.generateJavaScript();
    
    // Login system
    files['login.php'] = this.generateLoginPHP();
    files['logout.php'] = this.generateLogoutPHP();
    
    if (userTier === 'premium' || userTier === 'enterprise') {
      files['reports.php'] = this.generateReportsPHP();
      files['settings.php'] = this.generateSettingsPHP();
    }
    
    if (userTier === 'enterprise') {
      files['multi_server.php'] = this.generateMultiServerPHP();
      files['api_keys.php'] = this.generateAPIKeysPHP();
    }
    
    return files;
  }

  generateIndexPHP(userTier) {
    return `<?php
session_start();
require_once 'config.php';

if (!isset($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

// Get system stats
$stats = [
    'total_users' => 0,
    'active_users' => 0,
    'disk_usage' => '0 MB',
    'memory_usage' => '0%'
];

try {
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM ssh_users");
    $stats['total_users'] = $stmt->fetch()['total'];
    
    $stmt = $pdo->query("SELECT COUNT(*) as active FROM ssh_users WHERE status = 'active'");
    $stats['active_users'] = $stmt->fetch()['active'];
} catch (Exception $e) {
    error_log("Database error: " . $e->getMessage());
}
?>
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SSH Panel Management</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
    <div class="sidebar">
        <div class="logo">
            <h2><i class="fas fa-server"></i> SSH Panel</h2>
            <span class="tier-badge tier-<?php echo strtolower('${userTier}'); ?>"><?php echo ucfirst('${userTier}'); ?></span>
        </div>
        <nav class="nav-menu">
            <a href="index.php" class="nav-item active">
                <i class="fas fa-tachometer-alt"></i> Dashboard
            </a>
            <a href="users.php" class="nav-item">
                <i class="fas fa-users"></i> Users Management
            </a>
            <a href="add_user.php" class="nav-item">
                <i class="fas fa-user-plus"></i> Add User
            </a>
            <?php if ('${userTier}' === 'premium' || '${userTier}' === 'enterprise'): ?>
            <a href="reports.php" class="nav-item">
                <i class="fas fa-chart-bar"></i> Reports
            </a>
            <a href="settings.php" class="nav-item">
                <i class="fas fa-cog"></i> Settings
            </a>
            <?php endif; ?>
            <?php if ('${userTier}' === 'enterprise'): ?>
            <a href="multi_server.php" class="nav-item">
                <i class="fas fa-network-wired"></i> Multi Server
            </a>
            <a href="api_keys.php" class="nav-item">
                <i class="fas fa-key"></i> API Keys
            </a>
            <?php endif; ?>
            <a href="logout.php" class="nav-item logout">
                <i class="fas fa-sign-out-alt"></i> Logout
            </a>
        </nav>
    </div>

    <div class="main-content">
        <div class="header">
            <h1>Dashboard</h1>
            <div class="user-info">
                <span class="welcome">Welcome, Admin</span>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-users"></i>
                </div>
                <div class="stat-info">
                    <h3><?php echo $stats['total_users']; ?></h3>
                    <p>Total Users</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-user-check"></i>
                </div>
                <div class="stat-info">
                    <h3><?php echo $stats['active_users']; ?></h3>
                    <p>Active Users</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-hdd"></i>
                </div>
                <div class="stat-info">
                    <h3><?php echo $stats['disk_usage']; ?></h3>
                    <p>Disk Usage</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-memory"></i>
                </div>
                <div class="stat-info">
                    <h3><?php echo $stats['memory_usage']; ?></h3>
                    <p>Memory Usage</p>
                </div>
            </div>
        </div>

        <div class="content-grid">
            <div class="card">
                <div class="card-header">
                    <h3>Recent Users</h3>
                    <a href="users.php" class="btn btn-primary">View All</a>
                </div>
                <div class="card-body">
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Username</th>
                                    <th>Status</th>
                                    <th>Created</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="recent-users">
                                <!-- Dynamic content will be loaded here -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>System Information</h3>
                </div>
                <div class="card-body">
                    <div class="system-info">
                        <div class="info-item">
                            <strong>Server IP:</strong>
                            <span><?php echo $_SERVER['SERVER_ADDR']; ?></span>
                        </div>
                        <div class="info-item">
                            <strong>PHP Version:</strong>
                            <span><?php echo PHP_VERSION; ?></span>
                        </div>
                        <div class="info-item">
                            <strong>Panel Version:</strong>
                            <span>1.0.0</span>
                        </div>
                        <div class="info-item">
                            <strong>License:</strong>
                            <span class="tier-badge tier-<?php echo strtolower('${userTier}'); ?>">
                                <?php echo ucfirst('${userTier}'); ?>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="script.js"></script>
    <script>
        // Load recent users
        loadRecentUsers();
        
        function loadRecentUsers() {
            fetch('api.php?action=recent_users')
                .then(response => response.json())
                .then(data => {
                    const tbody = document.getElementById('recent-users');
                    tbody.innerHTML = '';
                    
                    if (data.success && data.users.length > 0) {
                        data.users.forEach(user => {
                            const row = createUserRow(user);
                            tbody.appendChild(row);
                        });
                    } else {
                        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No users found</td></tr>';
                    }
                })
                .catch(error => {
                    console.error('Error loading users:', error);
                });
        }
        
        function createUserRow(user) {
            const row = document.createElement('tr');
            row.innerHTML = \`
                <td>\${user.username}</td>
                <td>
                    <span class="status-badge status-\${user.status}">
                        \${user.status}
                    </span>
                </td>
                <td>\${formatDate(user.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="editUser('\${user.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteUser('\${user.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            \`;
            return row;
        }
        
        function formatDate(dateString) {
            const date = new Date(dateString);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        }
        
        function editUser(userId) {
            // Implement edit functionality
            window.location.href = 'edit_user.php?id=' + userId;
        }
        
        function deleteUser(userId) {
            if (confirm('Are you sure you want to delete this user?')) {
                fetch('api.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'delete_user',
                        user_id: userId
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        loadRecentUsers();
                        showNotification('User deleted successfully', 'success');
                    } else {
                        showNotification('Error deleting user: ' + data.message, 'error');
                    }
                })
                .catch(error => {
                    showNotification('Error deleting user', 'error');
                });
            }
        }
        
        // Auto refresh every 30 seconds
        setInterval(loadRecentUsers, 30000);
    </script>
</body>
</html>`;
  }

  generateConfigPHP() {
    return `<?php
// Database Configuration
define('DB_HOST', 'localhost');
define('DB_NAME', 'ssh_panel');
define('DB_USER', 'sshpanel');
define('DB_PASS', '{{DB_PASSWORD}}'); // Will be replaced during installation

// Panel Configuration
define('PANEL_TITLE', 'SSH User Management Panel');
define('PANEL_VERSION', '1.0.0');
define('MAX_USERS', {{MAX_USERS}}); // Will be replaced based on tier
?>`;
  }

  generateDatabaseSchema() {
    return `-- SSH Panel Database Schema
CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ssh_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  status ENUM('active', 'inactive', 'expired') DEFAULT 'active',
  max_connections INT DEFAULT 1,
  expire_date DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(100),
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES ssh_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO system_settings (setting_key, setting_value) VALUES 
('panel_title', 'SSH User Management Panel'),
('max_users', '10'),
('default_expire_days', '30')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);`;
  }

  async configurePanelSettings(serverIP, installPath, panelConfig, userTier) {
    const { panelUsername, panelPassword } = panelConfig;
    
    // Create database configuration
    const dbPassword = this.generateRandomPassword(16);
    const configContent = `<?php
define('DB_HOST', 'localhost');
define('DB_NAME', 'ssh_panel');
define('DB_USER', 'sshpanel');
define('DB_PASS', '${dbPassword}');
define('PANEL_TITLE', 'SSH User Management Panel');
define('PANEL_VERSION', '1.0.0');
define('USER_TIER', '${userTier}');
define('MAX_USERS', ${USER_TIERS[userTier].maxUsers});
define('ADMIN_USERNAME', '${panelUsername}');
define('ADMIN_PASSWORD', '${await bcrypt.hash(panelPassword, 10)}');
?>`;

    // Write config file
    await sshManager.executeCommand(serverIP, `cat > ${installPath}/config.php << 'EOF'
${configContent}
EOF`);

    // Setup database
    await sshManager.executeCommand(serverIP, `mysql -e "CREATE DATABASE IF NOT EXISTS ssh_panel;"`);
    await sshManager.executeCommand(serverIP, `mysql ssh_panel < ${installPath}/install.sql`);
  }

  async finalizeInstallation(serverIP, installPath, panelConfig) {
    // Setup Apache virtual host
    const vhostConfig = `<VirtualHost *:80>
    DocumentRoot ${installPath}
    DirectoryIndex index.php
    
    <Directory ${installPath}>
        AllowOverride All
        Require all granted
    </Directory>
    
    ErrorLog \${APACHE_LOG_DIR}/ssh_panel_error.log
    CustomLog \${APACHE_LOG_DIR}/ssh_panel_access.log combined
</VirtualHost>`;

    await sshManager.executeCommand(serverIP, `cat > /etc/apache2/sites-available/ssh-panel.conf << 'EOF'
${vhostConfig}
EOF`);

    await sshManager.executeCommand(serverIP, 'a2ensite ssh-panel');
    await sshManager.executeCommand(serverIP, 'systemctl reload apache2');
    
    // Create initial admin user in database
    const { panelUsername, panelPassword } = panelConfig;
    const hashedPassword = await bcrypt.hash(panelPassword, 10);
    
    await sshManager.executeCommand(serverIP, 
      `mysql ssh_panel -e "INSERT INTO admin_users (username, password, created_at) VALUES ('${panelUsername}', '${hashedPassword}', NOW()) ON DUPLICATE KEY UPDATE password='${hashedPassword}';"`
    );
  }
}

module.exports = new PanelInstaller();