# Lefu WiFi Torre Scale Server

Server for receiving device registration, configuration, and measurement data from Lefu WiFi Torre smart scales.

## 🚀 Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Start development server (with auto-reload)
npm run dev

# Or start production server
npm start
```

Server will start on `http://localhost:8000` (or port specified by `PORT` environment variable).

## 📡 API Endpoints

### Torre Scale Endpoints (via `/devices/claim` path)

These are the endpoints your scale hardware will use:

- **POST** `/devices/claim/lefu/wifi/torre/register` - Device registration
- **POST** `/devices/claim/lefu/wifi/torre/config` - Device configuration sync
- **POST** `/devices/claim/lefu/wifi/torre/record` - Measurement data upload

### Root Path Endpoints (for testing)

- **POST** `/lefu/wifi/torre/register` - Device registration
- **POST** `/lefu/wifi/torre/config` - Device configuration sync
- **POST** `/lefu/wifi/torre/record` - Measurement data upload

### Response Format

All endpoints return responses in the following format:

```json
{
  "errorCode": 0,
  "text": "Success message",
  "data": { ... }
}
```

- `errorCode`: `0` for success, `1` for failure
- `text`: Human-readable message
- `data`: Response payload (varies by endpoint)

## 🌐 Deploy to Railway

Railway is a modern platform that makes deploying Node.js apps easy. Follow these steps:

### Prerequisites

- A [GitHub](https://github.com) account
- A [Railway](https://railway.app) account (free tier available)

### Step 1: Prepare Your Code

1. **Initialize Git** (if not already done):

   ```bash
   git init
   git add .
   git commit -m "Initial commit - Railway ready"
   ```

2. **Create a GitHub Repository**:

   - Go to [GitHub](https://github.com/new)
   - Create a new repository (e.g., `nuhealth-server`)
   - **Don't** initialize with README (you already have one)

3. **Push to GitHub**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/nuhealth-server.git
   git branch -M main
   git push -u origin main
   ```
   Replace `YOUR_USERNAME` with your GitHub username.

### Step 2: Deploy on Railway

1. **Sign up/Login to Railway**:

   - Go to [railway.app](https://railway.app)
   - Click "Login" and sign in with GitHub

2. **Create a New Project**:

   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Authorize Railway to access your GitHub account (if prompted)
   - Select your `nuhealth-server` repository

3. **Railway Auto-Detection**:

   - Railway will automatically detect it's a Node.js project
   - It will run `npm install` and `npm start`
   - The deployment will start automatically

4. **Get Your Public URL**:
   - Once deployed, click on your project
   - Go to the "Settings" tab
   - Scroll down to "Domains"
   - Railway provides a default domain like: `your-app-name.up.railway.app`
   - **Copy this URL** - this is your server endpoint!

### Step 3: Configure Your Scale Device

Update your scale's server URL to use the Railway domain:

```
https://your-app-name.up.railway.app/devices/claim/lefu/wifi/torre/register
https://your-app-name.up.railway.app/devices/claim/lefu/wifi/torre/config
https://your-app-name.up.railway.app/devices/claim/lefu/wifi/torre/record
```

**Note:** Railway provides HTTPS automatically, so use `https://` not `http://`

### Step 4: Monitor Your Deployment

1. **View Logs**:

   - In Railway dashboard, click on your service
   - Go to "Deployments" tab
   - Click on the latest deployment
   - View real-time logs to see incoming requests

2. **Check Health**:
   - Your server logs all requests with detailed information
   - You'll see device registration, config sync, and measurement uploads

## 🔧 Environment Variables

The server uses the following environment variables (Railway sets these automatically):

- `PORT` - Server port (Railway sets this automatically)
- `RAILWAY_PUBLIC_DOMAIN` - Your Railway domain (set automatically)

You can add custom environment variables in Railway:

1. Go to your project → Settings → Variables
2. Add any variables you need
3. They'll be available as `process.env.VARIABLE_NAME`

## 📝 Testing with Postman/curl

### Test Device Registration

```bash
curl -X POST https://your-app-name.up.railway.app/devices/claim/lefu/wifi/torre/register \
  -H "Content-Type: application/json" \
  -d '{
    "sn": "lf21FD0001",
    "type": "CF577",
    "mac": "CF:E7:07:05:D0:32",
    "bleVersion": "1.0.0",
    "resVersion": "1.0.0",
    "mcuVersion": "1.0.0",
    "wifiVersion": "1.0.0",
    "hardwareVersion": "CF577",
    "skuCode": "CF577"
  }'
```

### Test Measurement Upload

```bash
curl -X POST https://your-app-name.up.railway.app/devices/claim/lefu/wifi/torre/record \
  -H "Content-Type: application/json" \
  -d '{
    "sn": "lf21FD0001",
    "type": "CF577",
    "mac": "CF:E7:07:05:D0:32",
    "bat": "0.85",
    "scaleType": 0,
    "list": [
      {
        "memberid": "12345678",
        "userid": "user001",
        "weight": 70.5,
        "timestamp": 1731686400,
        "heartRate": 75,
        "data": [
          {
            "impedance": "50000"
          }
        ]
      }
    ]
  }'
```

## 🐛 Troubleshooting

### Deployment Issues

1. **Build Fails**:

   - Check Railway logs for error messages
   - Ensure `package.json` has correct `start` script
   - Verify Node.js version compatibility (18+)

2. **Server Not Responding**:

   - Check Railway deployment logs
   - Verify the domain is correct
   - Ensure your scale is using `https://` not `http://`

3. **CORS Errors**:
   - The server doesn't use CORS middleware (allows all origins)
   - If you need CORS restrictions, add `cors` package and configure

### Local Development Issues

1. **Port Already in Use**:

   ```bash
   # Change PORT environment variable
   PORT=3000 npm start
   ```

2. **Dependencies Not Installing**:
   ```bash
   # Clear cache and reinstall
   rm -rf node_modules package-lock.json
   npm install
   ```

## 📊 Logging

The server logs all requests with:

- Timestamp
- HTTP method and path
- Request headers
- Request body (if present)
- Response data

Logs are visible in:

- **Local**: Terminal/console
- **Railway**: Dashboard → Deployments → Logs

## 🔒 Security Notes

- **HTTPS**: Railway provides HTTPS automatically
- **No Authentication**: Current implementation has no auth (add if needed)
- **No Database**: Data is logged but not persisted (add database if needed)
- **Rate Limiting**: Not implemented (add if needed for production)

## 📚 Next Steps

- Add database (PostgreSQL, MongoDB) to persist measurements
- Add authentication/authorization
- Add rate limiting
- Add data validation
- Set up monitoring/alerts
- Add webhook notifications

## 📄 License

ISC

## 🤝 Support

For issues or questions:

1. Check Railway deployment logs
2. Review server console logs
3. Test endpoints with Postman/curl
4. Verify scale device configuration

---

**Made for Lefu WiFi Torre Smart Scales** ⚖️
