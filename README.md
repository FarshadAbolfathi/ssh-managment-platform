# Management Platform

This project allows you to install a user management panel on your Linux server with just a few clicks and manage users easily. It consists of a React frontend and a Node.js backend, providing a web-based interface for managing various services and functionalities.

The project is bilingual, supporting both Persian (Farsi) and English languages.


## Technologies Used

- Frontend: React, Tailwind CSS, PostCSS
- Backend: Node.js, Express
- Other: SSH management, file uploading, installation services

## Project Structure

- `frontend/`: React frontend source code and configuration
- `backend/`: Node.js backend source code and API routes
- `panel-files/`: Additional PHP scripts and assets for panel management

## Getting Started

### Prerequisites

- Node.js (v14 or higher recommended)
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the backend server:
   ```bash
   node app.js
   ```
   The backend server will start on the configured port (default is usually 3001 or as set in `config.js`).

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the frontend development server:
   ```bash
   npm start
   ```
   The frontend will be available at `http://localhost:3000`.

## Building for Production

To build the frontend for production, run the following in the `frontend` directory:

```bash
npm run build
```

This will create an optimized build in the `frontend/build` directory.

## Additional Notes

- The backend includes services for SSH management, file uploading, and installation automation.
- The `panel-files` directory contains PHP scripts and assets for additional panel functionalities.
- Make sure to configure any environment variables or configuration files as needed before running the project.

## License

This project is licensed under the MIT License.
