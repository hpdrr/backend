// Use dotenv for development. In production (GCP), environment variables are set directly.
import 'dotenv/config';

import Hapi from '@hapi/hapi';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { Storage } from '@google-cloud/storage';
import pg from 'pg';
import axios from 'axios';
import { client as GradioClient } from '@gradio/client';

// Import JSON data with an import assertion
import recipeData from './recipes.json' with { type: 'json' };

const { Pool } = pg;

// --- Load configuration from environment variables ---
const JWT_SECRET = process.env.JWT_SECRET;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8080";
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL;
const HUGGING_FACE_SPACE = process.env.HUGGING_FACE_SPACE;

// --- Transform recipe array into a searchable object ---
const recipes = recipeData.recipes.reduce((acc, recipe) => {
    // Normalize the key to be more robust: lowercase and single-spaced
    const key = recipe.name.toLowerCase().replace(/\s+/g, ' ');
    acc[key] = recipe;
    return acc;
}, {});

// In-memory store for reset codes.
const resetCodes = {};

// --- Service Initialization ---
let storage;
try {
  storage = new Storage();
  console.log("Google Cloud Storage client initialized successfully.");
} catch (error) {
  console.error("Could not initialize Google Cloud Storage client.", error);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

// Helper function
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

const init = async () => {
  if (!JWT_SECRET || !DATABASE_URL || !HUGGING_FACE_SPACE) {
    console.error("FATAL ERROR: JWT_SECRET, DATABASE_URL, and HUGGING_FACE_SPACE environment variables must be set.");
    process.exit(1);
  }
  try {
    const client = await pool.connect();
    console.log("Database connected successfully.");
    client.release();
  } catch (error) {
    console.error("FATAL ERROR: Failed to connect to the database.", error);
    process.exit(1);
  }

  const server = Hapi.server({
    port: PORT,
    host: HOST,
    routes: {
      cors: {
        origin: [
          "http://localhost:5173",
          "http://localhost:3000",
          "http://localhost:8080",
           FRONTEND_URL
        ].filter(Boolean),
        headers: ["Accept", "Authorization", "Content-Type", "If-None-Match", "X-File-Name", "X-File-Type"],
        credentials: true,
      },
    },
  });

  // --- ROUTES ---

    // REGISTER
    server.route({
        method: "POST",
        path: "/register",
        options: {
          validate: {
            payload: Joi.object({
              email: Joi.string().email().required(),
              name: Joi.string().min(2).required(),
              password: Joi.string().min(8).pattern(new RegExp("^(?=.*[A-Z])(?=.*\\d).+$")).required().messages({
                  "string.pattern.base": "Password must contain at least one uppercase letter and one number",
              }),
              confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
                  "any.only": "Password confirmation does not match password",
              }),
            }),
            failAction: (request, h, err) => h.response({ statusCode: 400, message: err.details[0].message }).code(400).takeover(),
          },
        },
        handler: async (request, h) => {
          const { email, name, password } = request.payload;
          try {
            const userCheck = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
            if (userCheck.rows.length > 0) {
              return h.response({ statusCode: 409, message: "Email already exists" }).code(409);
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUserQuery = "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name";
            const result = await pool.query(newUserQuery, [name, email, hashedPassword]);
            return h.response({ statusCode: 201, message: "User registered successfully", user: result.rows[0] }).code(201);
          } catch (err) {
            console.error("Error during registration:", err);
            return h.response({ statusCode: 500, message: "Internal Server Error" }).code(500);
          }
        },
    });

    // LOGIN
    server.route({
        method: "POST",
        path: "/login",
        options: {
          validate: {
            payload: Joi.object({
              email: Joi.string().email().required(),
              password: Joi.string().required(),
            }),
            failAction: (request, h, err) => h.response({ statusCode: 400, message: err.details[0].message }).code(400).takeover(),
          },
        },
        handler: async (request, h) => {
          const { email, password } = request.payload;
          try {
            const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
            const user = result.rows[0];
            if (!user || !(await bcrypt.compare(password, user.password_hash))) {
              return h.response({ statusCode: 401, message: "Invalid email or password" }).code(401);
            }
            const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
            return {
              token,
              message: "Login successfully",
              user: { id: user.id, email: user.email, name: user.name, profilePictureUrl: user.profile_picture_url || null },
            };
          } catch (err) {
            console.error("Error during login:", err);
            return h.response({ statusCode: 500, message: "Internal Server Error" }).code(500);
          }
        },
    });

    // Food Prediction Route
    server.route({
        method: "POST",
        path: "/predict",
        options: {
            validate: {
                headers: Joi.object({ authorization: Joi.string().required() }).unknown(true),
                payload: Joi.object({
                    imageUrl: Joi.string().uri().required(),
                }),
                failAction: (request, h, err) => h.response({ statusCode: 400, message: err.details[0].message }).code(400).takeover(),
            },
        },
        handler: async (request, h) => {
            const decodedToken = verifyToken(request.headers.authorization.substring(7));
            if (!decodedToken) { return h.response({ statusCode: 401, message: "Unauthorized" }).code(401); }

            const { imageUrl } = request.payload;
            try {
                const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                const imageBlob = new Blob([imageResponse.data], { type: imageResponse.headers['content-type'] });
                const app = await GradioClient(HUGGING_FACE_SPACE);
                const result = await app.predict("/predict", { image: imageBlob });

                if (!result || !result.data || !Array.isArray(result.data) || result.data.length < 1) {
                    return h.response({ statusCode: 404, message: "Could not identify the food in the image." }).code(404);
                }

                // --- FIX: Parse the prediction string and normalize for lookup ---
                const rawPredictionString = result.data[0]; // e.g., "Lumpia (Akurasi: 98.12%)"
                
                // 1. Isolate the name by splitting at the parenthesis and trimming whitespace
                const predictedName = rawPredictionString.split('(')[0].trim();
                
                // 2. Normalize the name for a robust, case-insensitive lookup
                const lookupKey = predictedName.toLowerCase().replace(/\s+/g, ' ');

                // 3. Find the recipe using the normalized key
                const recipe = recipes[lookupKey];
                
                if (!recipe) {
                    console.log(`Lookup failed. Predicted label: "${predictedName}", Normalized key: "${lookupKey}"`);
                    return h.response({ statusCode: 404, message: `Food '${predictedName}' identified, but no recipe is available yet.` }).code(404);
                }

                return h.response({
                    statusCode: 200,
                    prediction: {
                        label: recipe.name // Return the properly cased name from our recipe JSON
                    },
                    recipe: recipe
                }).code(200);

            } catch (error) {
                console.error("Error during prediction:", error);
                return h.response({ statusCode: 500, message: "An error occurred while processing the image." }).code(500);
            }
        }
    });
    
  // --- Server Start ---
  try {
    await server.start();
    console.log("Server running on %s", server.info.uri);
  } catch (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
};

init();
