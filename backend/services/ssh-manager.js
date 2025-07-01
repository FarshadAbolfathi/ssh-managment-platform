const { NodeSSH } = require('node-ssh');

class SSHManager {
  constructor() {
    this.connections = new Map();
  }

  async connect(serverData) {
    const { serverIP, sshUsername, sshPassword, sshPort } = serverData;
    const ssh = new NodeSSH();
    
    try {
      await ssh.connect({
        host: serverIP,
        username: sshUsername,
        password: sshPassword,
        port: parseInt(sshPort),
        tryKeyboard: true,
        onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish) => {
          if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
            finish([sshPassword]);
          }
        }
      });
      
      this.connections.set(serverIP, ssh);
      return ssh;
    } catch (error) {
      throw new Error(`SSH Connection failed: ${error.message}`);
    }
  }

  async executeCommand(serverIP, command, options = {}) {
    const ssh = this.connections.get(serverIP);
    if (!ssh) {
      throw new Error('SSH connection not found');
    }

    try {
      const result = await ssh.execCommand(command, options);
      return result;
    } catch (error) {
      throw new Error(`Command execution failed: ${error.message}`);
    }
  }

  async uploadFile(serverIP, localPath, remotePath) {
    const ssh = this.connections.get(serverIP);
    if (!ssh) {
      throw new Error('SSH connection not found');
    }

    try {
      await ssh.putFile(localPath, remotePath);
      return true;
    } catch (error) {
      throw new Error(`File upload failed: ${error.message}`);
    }
  }

  async uploadDirectory(serverIP, localPath, remotePath) {
    const ssh = this.connections.get(serverIP);
    if (!ssh) {
      throw new Error('SSH connection not found');
    }

    try {
      await ssh.putDirectory(localPath, remotePath, {
        recursive: true,
        concurrency: 10
      });
      return true;
    } catch (error) {
      throw new Error(`Directory upload failed: ${error.message}`);
    }
  }

  disconnect(serverIP) {
    const ssh = this.connections.get(serverIP);
    if (ssh) {
      ssh.dispose();
      this.connections.delete(serverIP);
    }
  }
}

module.exports = new SSHManager();