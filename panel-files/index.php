<?php
session_start();
require_once 'config.php';

if (!isset($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

// Example data for dashboard
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
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SSH Panel Dashboard</title>
    <link rel="stylesheet" href="style-new.css" />
</head>
<body>
<nav class="navbar">
  <div class="container-fluid">
    <a class="navbar-brand" href="#">SSH Panel</a>
    <ul class="navbar-nav">
      <li class="nav-item">
        <a class="nav-link active" href="index.php">Dashboard</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" href="users.php">Users</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" href="add_user.php">Add User</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" href="logout.php">Logout</a>
      </li>
    </ul>
  </div>
</nav>

<div class="container">
  <h1>Dashboard</h1>
  <div class="dashboard-cards">
    <div class="card">
      <div class="card-header">Total Users</div>
      <div class="card-body">
        <?php echo $stats['total_users']; ?>
      </div>
    </div>
    <div class="card">
      <div class="card-header">Active Users</div>
      <div class="card-body">
        <?php echo $stats['active_users']; ?>
      </div>
    </div>
    <div class="card">
      <div class="card-header">Disk Usage</div>
      <div class="card-body">
        <?php echo $stats['disk_usage']; ?>
      </div>
    </div>
    <div class="card">
      <div class="card-header">Memory Usage</div>
      <div class="card-body">
        <?php echo $stats['memory_usage']; ?>
      </div>
    </div>
  </div>
</div>

</body>
</html>
