<?php
session_start();
require_once 'config.php';

if (!isset($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'] ?? '';
    $password = $_POST['password'] ?? '';

    if ($username && $password) {
        try {
            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT INTO ssh_users (username, password) VALUES (?, ?)");
            $stmt->execute([$username, $hashedPassword]);
            $success = "User added successfully.";
        } catch (Exception $e) {
            $error = "Error adding user: " . $e->getMessage();
        }
    } else {
        $error = "Please provide username and password.";
    }
}
?>

<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8" />
    <title>Add User - SSH Panel</title>
    <link rel="stylesheet" href="style-new.css" />
</head>
<body>
<nav class="navbar">
  <div class="container-fluid">
    <a class="navbar-brand" href="#">SSH Panel</a>
    <ul class="navbar-nav">
      <li class="nav-item">
        <a class="nav-link" href="index.php">Dashboard</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" href="users.php">Users</a>
      </li>
      <li class="nav-item">
        <a class="nav-link active" href="add_user.php">Add User</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" href="logout.php">Logout</a>
      </li>
    </ul>
  </div>
</nav>

<div class="container">
    <div class="form-container">
        <h2>Add User</h2>
        <?php if (isset($error)): ?>
            <div class="error-message"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>
        <?php if (isset($success)): ?>
            <div class="success-message"><?php echo htmlspecialchars($success); ?></div>
        <?php endif; ?>
        <form method="POST" action="add_user.php">
            <label for="username">Username:</label>
            <input type="text" id="username" name="username" required />
            <label for="password">Password:</label>
            <input type="password" id="password" name="password" required />
            <button type="submit">Add User</button>
        </form>
    </div>
</div>

</body>
</html>
