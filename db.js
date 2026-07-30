{
  "name": "companion-studio",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node backend/server.js",
    "dev": "nodemon backend/server.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "bcrypt": "^5.1.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "elevenlabs": "^0.17.0",
    "express": "^4.19.2",
    "express-rate-limit": "^7.3.1",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "node-cron": "^3.0.3",
    "pg": "^8.12.0",
    "replicate": "^0.31.0",
    "stripe": "^16.2.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.4"
  }
}
