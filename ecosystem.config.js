// Configuración opcional de PM2. Uso: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "bluefishing-bot",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "300M",
      autorestart: true,
    },
  ],
};
