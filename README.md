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
- `SUPABASE_URL` - Your Supabase project URL (required for data persistence)
- `SUPABASE_ANON_KEY` - Your Supabase anonymous/public key (required for data persistence)
- `LEFU_APP_KEY` - Lefu API app key (optional, defaults to provided value)
- `LEFU_APP_SECRET` - Lefu API app secret (optional, defaults to provided value)

You can add custom environment variables in Railway:

1. Go to your project → Settings → Variables
2. Add any variables you need
3. They'll be available as `process.env.VARIABLE_NAME`

## 🔌 Lefu API Integration

The server automatically integrates with the Lefu API to fetch detailed body composition data:

1. **Token Management**: Automatically fetches and caches authentication tokens from the Lefu API
2. **Impedance Processing**: Extracts impedance array from incoming requests and maps it to API parameters
3. **Body Data Fetching**: Calls the Lefu API to get comprehensive body composition data
4. **Data Storage**: Saves the fetched body data to Supabase

### How It Works

When a record request is received:

1. The server extracts impedance data and other parameters (age, height, weight, sex, product) from the request
2. Maps the 10-element impedance array to the correct API parameters:
   - Array[0]: 20kHz right arm impedance
   - Array[1]: 100kHz right arm impedance
   - Array[2]: 20kHz left arm impedance
   - Array[3]: 100kHz left arm impedance
   - Array[4]: 20kHz trunk impedance
   - Array[5]: 100kHz trunk impedance
   - Array[6]: 20kHz right leg impedance
   - Array[7]: 100kHz right leg impedance
   - Array[8]: 20kHz left leg impedance
   - Array[9]: 100kHz left leg impedance
3. Fetches authentication token from Lefu API (cached for efficiency)
4. Calls the body data API endpoint with mapped parameters
5. Saves the complete body data to Supabase

The server handles multiple request formats and will automatically extract impedance data from various locations in the request body.

## 🗄️ Supabase Database Setup

The server automatically saves measurement records to Supabase. It will:

- Fetch body data from Lefu API if impedance data is available
- Save records when `code: 200` is received
- Store complete body composition data

Follow these steps to set up:

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project
3. Wait for the project to be fully provisioned

### Step 2: Create Database Table

1. In your Supabase dashboard, go to **SQL Editor**
2. Copy and paste the contents of `supabase-migration.sql`
3. Click **Run** to execute the migration
4. This creates the `scale_records` table with proper indexes

### Step 3: Get Your Credentials

1. Go to **Settings** → **API** in your Supabase dashboard
2. Copy your **Project URL** (this is your `SUPABASE_URL`)
3. Copy your **anon/public** key (this is your `SUPABASE_ANON_KEY`)

### Step 4: Configure Environment Variables

**For Railway:**

1. Go to your Railway project → Settings → Variables
2. Add `SUPABASE_URL` with your project URL
3. Add `SUPABASE_ANON_KEY` with your anon key
4. Redeploy your service

**For Local Development:**
Create a `.env` file (or export variables):

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key-here"
```

### Database Schema

The `scale_records` table stores:

- `id` - Auto-incrementing primary key
- `code` - Response code (200 = success)
- `msg` - Response message
- `version` - Device firmware version
- `error_type` - Error type from device
- `lefu_body_data` - JSONB array of body measurements
- `full_data` - Complete JSON payload for reference
- `created_at` - Timestamp when record was created
- `updated_at` - Timestamp when record was last updated

### Querying Data

You can query the data in Supabase SQL Editor:

```sql
-- Get all records
SELECT * FROM scale_records ORDER BY created_at DESC;

-- Get records with specific body parameter
SELECT * FROM scale_records
WHERE lefu_body_data @> '[{"bodyParamKey": "ppWeightKg"}]';

-- Get latest weight measurements
SELECT
  created_at,
  full_data->'data'->'lefuBodyData'->0->>'currentValue' as weight
FROM scale_records
WHERE code = 200
ORDER BY created_at DESC;
```

## 📝 Testing with Postman/curl

### Test Device Registration$$

```bash$$
curl -X POST  https://nuhealth-server-production.up.railway.app/devices/claim/lefu/wifi/torre/register \
  -H "Content-Type: application/json" \
  -d '{
    "sn": "CFE9FA280015",
    "type": "Nubody+",
    "mac": "CF:E9:FA:28:00:15",
    "bleVersion": "0.0.2",
    "resVersion": "0.3.0",
    "mcuVersion": "0.0.2",
    "wifiVersion": "0.0.4",
    "hardwareVersion": "v1.0",
    "skuCode": "EN",
    "wifiSsid": "gigacube-A308E1",
    "WifiPassword":"2tErj9T55j265265"
  }'
```

---

### Test Measurement Upload

```bash
curl -X POST http://192.168.0.206:8000/devices/claim/lefu/wifi/torre/record \
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
- **Database**: Data is persisted to Supabase when `code: 200` is received
- **Rate Limiting**: Not implemented (add if needed for production)

## 📚 Next Steps

- ✅ Database persistence (Supabase) - **COMPLETED**
- Add authentication/authorization
- Add rate limiting
- Add data validation
- Set up monitoring/alerts
- Add webhook notifications
- Create API endpoints to retrieve historical data

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
