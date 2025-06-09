# Foodinary Backend API

A backend service for the Foodinary application, focusing on Indonesian traditional cuisine recipe prediction and management.

## Overview

This API provides the following features:

- User authentication (register, login)
- Password reset via email
- Food prediction using machine learning (via Hugging Face)
- Recipe information retrieval
- User history and favorites management

## Tech Stack

- **Framework**: [Hapi.js](https://hapi.dev/)
- **Database**: PostgreSQL (via pg)
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Joi
- **Image Storage**: Google Cloud Storage
- **ML Integration**: Gradio client for Hugging Face
- **Other**: bcryptjs, nodemailer, axios

## Setup

### Prerequisites

- Node.js (v18+ recommended)
- PostgreSQL database
- Google Cloud Storage bucket (for profile pictures)
- Gmail account (for sending reset emails)
- Hugging Face space deployment

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the project root with the following variables:
   ```
   GMAIL_USER=your-gmail@gmail.com
   GMAIL_PASS=your-gmail-app-password
   HOST=localhost
   GCS_BUCKET_NAME=foodinary-profile-picture
   GOOGLE_APPLICATION_CREDENTIALS=path-to-your-credentials.json
   DATABASE_URL=postgresql://user:password@host:port/database
   JWT_SECRET=your-secret-key
   HUGGING_FACE_SPACE=your-hugging-face-space
   FRONTEND_URL=http://your-frontend-url
   ```
4. Start the server:
   ```bash
   # Development mode
   npm run start-dev
   # Production mode
   npm start
   ```

## API Endpoints

### Authentication

- **POST /register**

  - Register a new user
  - Body: `{ email, name, password, confirmPassword }`
  - Password must contain at least one uppercase letter and one number

- **POST /login**

  - Authenticate a user
  - Body: `{ email, password }`
  - Returns: JWT token and user info

- **POST /reset-password**
  - Request a password reset (send email with token)
  - Body: `{ email }`
  - To reset: `{ email, token, newPassword }`

### Food Prediction

- **POST /predict**
  - Predict food from an image URL
  - Headers: `Authorization: Bearer <token>`
  - Body: `{ imageUrl }`
  - Returns: Prediction and recipe information

### Favorites & History

- **GET /favorites** — Get user's favorite recipes (JWT required)
- **PUT /favorites** — Add or update user's favorite recipes (JWT required)
- **GET /history** — Get user's prediction history (JWT required)
- **DELETE /delete-history** — Delete user's prediction history (JWT required)

## Data Structure

The application uses a `recipes.json` file containing detailed information about Indonesian dishes, including:

- Recipe name
- Dominant taste
- Region of origin
- Description
- Tools and ingredients
- Preparation steps
- Image URL

## Deployment

The application can be deployed using Docker. A Dockerfile is provided for containerization.

```bash
# Build Docker image
docker build -t foodinary-backend .
# Run Docker container
docker run -p 3000:3000 --env-file .env foodinary-backend
```

## License

ISC
