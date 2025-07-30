<?php
session_start();
require_once 'config.php';

if (!isset($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = $_POST['user_id'] ?? '';

    if ($userId) {
        try {
            $stmt = $pdo->prepare("DELETE FROM ssh_users WHERE id = ?");
            $stmt->execute([$userId]);
            $success = "User deleted successfully.";
        } catch (Exception $e) {
            $error = "Error deleting user: " . $e->getMessage();
        }
    } else {
        $error = "Invalid user ID.";
    }
}
?>
