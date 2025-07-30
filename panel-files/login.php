<?php
session_start();
require_once 'config.php';

if (isset($_POST['username']) && isset($_POST['password'])) {
    $username = $_POST['username'];
    $password = $_POST['password'];

    try {
        $stmt = $pdo->prepare("SELECT * FROM admin_users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        if ($user && password_verify($password, $user['password'])) {
            $_SESSION['admin_logged_in'] = true;
            $_SESSION['admin_username'] = $username;
            header('Location: index.php');
            exit;
        } else {
            $error = "Invalid username or password";
        }
    } catch (Exception $e) {
        error_log("Database error: " . $e->getMessage());
        $error = "Database connection error";
    }
}

// Debug tool - remove in production
if (isset($_GET['generate_hash']) && isset($_GET['pass'])) {
    $password = $_GET['pass'];
    $hash = password_hash($password, PASSWORD_BCRYPT);
    echo "Password: " . htmlspecialchars($password) . "<br>";
    echo "Hash: " . htmlspecialchars($hash) . "<br>";
    echo "<a href='login.php'>Back to Login</a>";
    exit;
}
?>

<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8" />
    <title>Login - SSH Panel</title>
    <link rel="stylesheet" href="style-new.css" />
</head>
<body>
    <div class="login-container">
        <h2>Login</h2>
        <?php if (isset($error)): ?>
            <div class="error-message"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>
        <form method="POST" action="login.php">
            <label for="username">Username:</label>
            <input type="text" id="username" name="username" required />
            <label for="password">Password:</label>
            <input type="password" id="password" name="password" required />
            <button type="submit">Login</button>
        </form>
    </div>
</body>
</html>