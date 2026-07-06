// Biyo Body Scanner — official FAQs & Troubleshooting Guide, verbatim source of
// truth for device setup / connectivity / scanning support questions in the RAI
// chat. The model must answer troubleshooting questions STRICTLY from this — see
// TROUBLESHOOTING_INSTRUCTION below. Edit copy here only.

const TROUBLESHOOTING_GUIDE = `
=== BIYO BODY SCANNER — FAQs & TROUBLESHOOTING GUIDE ===

# SETUP & CONNECTIVITY

Do I need Wi-Fi, or can I use Bluetooth only?
- You can use the scanner with Bluetooth only, but Wi-Fi is highly recommended: a Wi-Fi connection sends results to the app automatically, so you can view them within seconds of a scan.
- Bluetooth is NOT a constant connection — your phone moves out of range during the day. On Bluetooth only, you must manually resync after each scan: Dashboard -> Settings (top right) -> step on the device to wake it -> tap Connect to initiate the Bluetooth connection.

How do I set up Wi-Fi?
- During setup, onboarding configures both Bluetooth and Wi-Fi. To change Wi-Fi or reconnect later: Dashboard -> Settings (top right) -> step on the device to wake it -> tap Connect (Bluetooth) -> once connected, tap the Wi-Fi icon (top right) to change your Wi-Fi settings.
- The device displays "Successful" when Wi-Fi connects correctly.
- Once connected, the Wi-Fi symbol on the device turns from RED to BLUE (can take a few seconds after waking).

How do I connect via Bluetooth?
- To reconnect Bluetooth: Dashboard -> Settings (top right) -> step on the device to wake it -> tap Connect to initiate the Bluetooth connection.
- Once connected, the Bluetooth symbol on the device turns from RED to BLUE (can take a few seconds after waking).

Common reasons a BLUETOOTH connection FAILS:
- Bluetooth permission has not been granted — open your phone's Settings and grant permission to the Biyo app.
- The device is out of range of your phone (the scanner has a 10 m range).
- The device is in sleep mode — step on it to wake it.

Common reasons a WI-FI connection FAILS:
- An incorrect Wi-Fi password.
- The device is out of range of your router.
- A router (network) name longer than 21 characters, or one that contains emojis.
- If you've checked all of the above and it still won't connect, contact support@biyo.com.

# USING THE APP

Set up a goal: Dashboard -> Settings (top right) -> Set Your Goals -> set as many goals as you like -> tap Save Goals.
Create an action plan: Actions tab -> Create a Plan -> choose your goal and programme details.
Export results: Body tab -> Settings button (second from the left along the top) -> Export Body Data. CSV only (opens in Excel).

# TROUBLESHOOTING YOUR RESULTS

Data not showing (you scanned but data isn't coming through):
1. Check the Wi-Fi icon is BLUE — after stepping on the scale it should turn blue within a few seconds. If it failed, the common causes are the Wi-Fi ones above.
2. Check you're scanning correctly — the on-device screen should show 8 metrics. If it shows only 2, the full-body scan is incomplete and won't save. Ensure contact with all eight electrodes: remove socks, make sure hands/feet aren't too dry, remove jewellery.
3. Ensure results save to the correct profile — with multiple users on one scale, select the correct profile.
4. Still not working? Contact support@biyo.com.

Data doesn't look right:
- The algorithm uses onboarding data. Check/edit it: Dashboard -> Settings (top right) -> Profile Info. Then sync: Settings -> step on the device -> tap Connect -> once connected, the profile updates.
- Make sure the body type in profile info is correct or results may not match your body. See the "Perfect Scan" guidance.

Why are scale and app results different?
- The app applies a learning algorithm tailored to your body that can't run on the device itself. The APP results are always the most accurate.

# GOLD PROTOCOL: HOW TO RUN A "PERFECT" SCAN
1. Timing & frequency: scan same time of day, ideally first thing in the morning; empty bladder/bowels first; use the same device and location each time.
2. Pre-scan (previous 24h): avoid heavy alcohol, diuretics, big sodium swings; keep training consistent; avoid intense exercise 12-24h before; avoid large late-night meals.
3. Day-of: overnight fast (plain water only), keep morning fluids consistent; sanity-check hydration via urine colour; avoid caffeine, saunas, hot baths, high-sweat activity.
4. Device setup & positioning: confirm sex/age/height/athlete mode; hard level surface, never carpet; re-zero/recalibrate if moved; bare clean dry feet, no lotion; stand upright and still, arms relaxed not touching torso; no phone/metal during measurement; stay on until it signals completion.
5. Clothing & environment: repeat scans in similar/identical clothing (or nude); keep room temperature consistent.

# MANAGING USERS & DEVICE
Switch users: use the two black arrows in the black plastic handle (left/right of the screen) to toggle through users. Each user needs a separate account.
Delete users: Dashboard -> Settings -> step on device -> tap Connect -> Remove All Users -> tap Sync My Profile to resave your profile.
Delete a scan from your account: contact support@biyo.com.
Moving house (new Wi-Fi): Dashboard -> Settings -> step on device -> tap Connect -> tap the Wi-Fi icon (top right) -> change Wi-Fi settings.
Factory reset: Dashboard -> Settings -> step on device -> tap Connect -> tap Factory Reset (top right). Afterwards reconnect Wi-Fi and resync your profile.

Support email for anything not resolved here: support@biyo.com
`;

// Prepended to the guide when injected into the chat system prompt. Keeps the
// model grounded: troubleshooting answers must come ONLY from the guide.
const TROUBLESHOOTING_INSTRUCTION = `
DEVICE TROUBLESHOOTING KNOWLEDGE BASE
When the user asks ANYTHING about device setup, pairing, Bluetooth or Wi-Fi connectivity, syncing, why a scan/data isn't showing, scanning correctly, accuracy, managing users, factory reset, or moving the scanner, you MUST answer STRICTLY using the guide below.
- Do NOT invent or guess steps, menu paths, settings, ranges, numbers, or causes that are not in the guide.
- Use the exact steps and causes from the guide; you may rephrase for clarity but must not add new facts.
- If the guide does not cover the question, say you're not certain and direct them to support@biyo.com.
- For non-troubleshooting health/body-composition questions, answer normally as usual.
`;

module.exports = { TROUBLESHOOTING_GUIDE, TROUBLESHOOTING_INSTRUCTION };
