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
      try {
        await sshManager.connect(serverData);
        await this.logStep(installationId, 'Connected to server', 'info', 2);
      } catch (connError) {
        await this.updateInstallationData(installationId, {
          status: 'failed',
          error_message: `SSH connection error: ${connError.message}`
        });
        await this.logStep(installationId, `SSH connection error: ${connError.message}`, 'error', 0);
        throw connError;
      }

      // Execute installation steps
      for (const step of this.installationSteps) {
        try {
          await this.executeStep(step, serverData, panelConfig, installationId, userTier);
        } catch (stepError) {
          await this.updateInstallationData(installationId, {
            status: 'failed',
            error_message: `Step ${step.name} failed: ${stepError.message}`
          });
          await this.logStep(installationId, `Step ${step.name} failed: ${stepError.message}`, 'error', 0);
          throw stepError;
        }
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
          this.dbPassword = this.generateRandomPassword(16);
          const dbName = 'ssh_panel';
          const dbUser = 'sshpanel';
          
          // Setup MySQL with proper security
          await sshManager.executeCommand(serverIP, `mysql -e "CREATE DATABASE IF NOT EXISTS ${dbName};"`);
          await sshManager.executeCommand(serverIP, `mysql -e "DROP USER IF EXISTS '${dbUser}'@'localhost';"`);
          await sshManager.executeCommand(serverIP, `mysql -e "CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY '${this.dbPassword}';"`);
          await sshManager.executeCommand(serverIP, `mysql -e "GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'localhost';"`);
          await sshManager.executeCommand(serverIP, `mysql -e "FLUSH PRIVILEGES;"`);
          
          // Test database connection
          const testResult = await sshManager.executeCommand(serverIP, `mysql -u ${dbUser} -p'${this.dbPassword}' -e "SELECT 1;"`);
          if (testResult.code !== 0) {
            throw new Error(`Database connection test failed: ${testResult.stderr}`);
          }
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
    
    // Generate and upload panel files
    const panelFiles = this.generatePanelFiles(userTier);
    
    for (const [filename, content] of Object.entries(panelFiles)) {
      if (content) {
        await sshManager.executeCommand(serverIP, `cat > ${installPath}/${filename} << 'FILEEOF'
${content}
FILEEOF`);
      }
    }
  }

  generatePanelFiles(userTier) {
    const files = {};
    
    // Main index.php
    files['index.php'] = this.generateIndexPHP(userTier);
    
    // Configuration file
    files['config.php'] = this.generateConfigPHP();
    
    // Database schema
    files['install.sql'] = this.generateDatabaseSchema();
    
    // Login system
    files['login.php'] = this.generateLoginPHP();
    
    // Basic CSS
    files['style.css'] = this.generateCSS();
    
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
    $result = $stmt->fetch();
    $stats['total_users'] = $result ? $result['total'] : 0;
    
    $stmt = $pdo->query("SELECT COUNT(*) as active FROM ssh_users WHERE status = 'active'");
    $result = $stmt->fetch();
    $stats['active_users'] = $result ? $result['active'] : 0;
} catch (Exception $e) {
    error_log("Database error: " . $e->getMessage());
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SSH Panel Management</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>SSH Panel Dashboard</h1>
        <div class="stats">
            <div class="stat-card">
                <h3>Total Users</h3>
                <p><?php echo $stats['total_users']; ?></p>
            </div>
            <div class="stat-card">
                <h3>Active Users</h3>
                <p><?php echo $stats['active_users']; ?></p>
            </div>
        </div>
        <div class="actions">
            <a href="add_user.php" class="btn">Add User</a>
            <a href="users.php" class="btn">Manage Users</a>
            <a href="logout.php" class="btn">Logout</a>
        </div>
    </div>
</body>
</html>`;
  }

  generateConfigPHP() {
    return `<?php
// Database Configuration
$db_host = 'localhost';
$db_name = 'ssh_panel';
$db_user = 'sshpanel';
$db_pass = '{{DB_PASSWORD}}';

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die("Database connection failed: " . $e->getMessage());
}

// Panel Configuration
define('PANEL_TITLE', 'SSH User Management Panel');
define('PANEL_VERSION', '1.0.0');
define('MAX_USERS', {{MAX_USERS}});
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
);`;
  }

  generateLoginPHP() {
    return `<?php
session_start();
require_once 'config.php';

if (isset($_POST['login'])) {
    $username = $_POST['username'];
    $password = $_POST['password'];
    
    try {
        $stmt = $pdo->prepare("SELECT * FROM admin_users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        
        if ($user && password_verify($password, $user['password'])) {
            $_SESSION['admin_logged_in'] = true;
            $_SESSION['admin_username'] = $user['username'];
            header('Location: index.php');
            exit;
        } else {
            $error = 'Invalid username or password';
        }
    } catch (Exception $e) {
        $error = 'Database error: ' . $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SSH Panel Login</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="login-container">
        <h2>SSH Panel Login</h2>
        <?php if (isset($error)): ?>
            <div class="error"><?php echo $error; ?></div>
        <?php endif; ?>
        <form method="POST">
            <div class="form-group">
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" name="login">Login</button>
        </form>
    </div>
</body>
</html>`;
  }

  generateCSS() {
    return `body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 20px;
    background-color: #f5f5f5;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.login-container {
    max-width: 400px;
    margin: 100px auto;
    background: white;
    padding: 30px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin: 20px 0;
}

.stat-card {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
}

.stat-card h3 {
    margin: 0 0 10px 0;
    color: #333;
}

.stat-card p {
    font-size: 24px;
    font-weight: bold;
    color: #007bff;
    margin: 0;
}

.actions {
    margin-top: 30px;
}

.btn {
    display: inline-block;
    padding: 10px 20px;
    background: #007bff;
    color: white;
    text-decoration: none;
    border-radius: 4px;
    margin-right: 10px;
}

.btn:hover {
    background: #0056b3;
}

.form-group {
    margin-bottom: 15px;
}

.form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
}

.form-group input {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    box-sizing: border-box;
}

button {
    width: 100%;
    padding: 10px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

button:hover {
    background: #0056b3;
}

.error {
    background: #f8d7da;
    color: #721c24;
    padding: 10px;
    border-radius: 4px;
    margin-bottom: 15px;
}`;
  }

async configurePanelSettings(serverIP, installPath, panelConfig, userTier) {
  const { panelUsername, panelPassword } = panelConfig;
  
  // Replace placeholders in config.php
  const configContent = `<?php
// Database Configuration
$db_host = 'localhost';
$db_name = 'ssh_panel';
$db_user = 'sshpanel';
$db_pass = '${this.dbPassword}';

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die("Database connection failed: " . $e->getMessage());
}

// Panel Configuration
define('PANEL_TITLE', 'SSH User Management Panel');
define('PANEL_VERSION', '1.0.0');
define('MAX_USERS', ${USER_TIERS[userTier]?.maxUsers || 10});
?>`;

  // Write config file
  await sshManager.executeCommand(serverIP, `cat > ${installPath}/config.php << 'CONFIGEOF'
${configContent}
CONFIGEOF`);

  // Setup database tables
  await sshManager.executeCommand(serverIP, `mysql -u sshpanel -p'${this.dbPassword}' ssh_panel < ${installPath}/install.sql`);
  
  // Create admin user - FIX: Use PHP's password_hash instead of bcrypt
  // First, create a temporary PHP script to generate the hash
  const phpHashScript = `<?php
$password = '${panelPassword}';
$hash = password_hash($password, PASSWORD_BCRYPT);
echo $hash;
?>`;

  // Write the PHP script
  await sshManager.executeCommand(serverIP, `cat > ${installPath}/temp_hash.php << 'HASHEOF'
${phpHashScript}
HASHEOF`);

  // Execute the PHP script to get the hash
  const hashResult = await sshManager.executeCommand(serverIP, `php ${installPath}/temp_hash.php`);
  const hashedPassword = hashResult.stdout.trim();

  // Insert the user with the correctly hashed password
  await sshManager.executeCommand(serverIP, 
    `mysql -u sshpanel -p'${this.dbPassword}' ssh_panel -e "INSERT INTO admin_users (username, password) VALUES ('${panelUsername}', '${hashedPassword}') ON DUPLICATE KEY UPDATE password='${hashedPassword}';"`
  );

  // Clean up temporary file
  await sshManager.executeCommand(serverIP, `rm -f ${installPath}/temp_hash.php`);
}

  async finalizeInstallation(serverIP, installPath, panelConfig) {
    // Setup Apache virtual host
    const vhostConfig = `<VirtualHost *:80>
    DocumentRoot /var/www/html
    DirectoryIndex index.php
    
    Alias /panel ${installPath}
    
    <Directory ${installPath}>
        AllowOverride All
        Require all granted
    </Directory>
    
    ErrorLog \${APACHE_LOG_DIR}/ssh_panel_error.log
    CustomLog \${APACHE_LOG_DIR}/ssh_panel_access.log combined
</VirtualHost>`;

    await sshManager.executeCommand(serverIP, `cat > /etc/apache2/sites-available/ssh-panel.conf << 'VHOSTEOF'
${vhostConfig}
VHOSTEOF`);

    // Disable default site and enable panel site
    await sshManager.executeCommand(serverIP, 'a2dissite 000-default');
    await sshManager.executeCommand(serverIP, 'a2ensite ssh-panel');
    await sshManager.executeCommand(serverIP, 'systemctl restart apache2');
  }
}

module.exports = new PanelInstaller();