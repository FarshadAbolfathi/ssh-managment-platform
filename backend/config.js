module.exports = {
  dbConfig: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ssh_installer'
  },
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-this',
  USER_TIERS: {
    free: {
      maxServers: 1,
      maxUsers: 10,
      features: ['basic_management', 'limited_support'],
      price: 0
    },
    premium: {
      maxServers: 5,
      maxUsers: -1, // unlimited
      features: ['advanced_reporting', 'priority_support', 'api_access', 'multi_server'],
      price: 19
    },
    enterprise: {
      maxServers: -1, // unlimited
      maxUsers: -1, // unlimited
      features: ['multi_server', 'sso_integration', '24_7_support', 'custom_branding', 'white_label'],
      price: 49
    }
  }
};