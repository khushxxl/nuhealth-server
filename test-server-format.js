// test-server-formats.js - Try different response formats
const http = require("http");

// Track which format to try (rotate on each request)
let formatIndex = 0;

const formats = [
  {
    name: "Format 1: Minimal (code/message/data)",
    response: {
      code: 0,
      message: "success",
      data: {},
    },
  },
  {
    name: "Format 2: With status field",
    response: {
      status: 0,
      code: 0,
      message: "success",
      data: {},
    },
  },
  {
    name: "Format 3: Minimal with msg (not message)",
    response: {
      code: 0,
      msg: "success",
      data: {},
    },
  },
  {
    name: "Format 4: With deviceId and deviceKey",
    response: {
      code: 0,
      message: "success",
      data: {
        deviceId: "CFE9FA280014",
        deviceKey: "test_key_123",
      },
    },
  },
  {
    name: "Format 5: Empty data object",
    response: {
      code: 0,
      message: "success",
      data: null,
    },
  },
  {
    name: "Format 6: No data field",
    response: {
      code: 0,
      message: "success",
    },
  },
];

const server = http.createServer((req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[${timestamp}] ${req.method} ${req.url}`);

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    if (body) {
      try {
        const parsed = JSON.parse(body);
        console.log(`Device SN: ${parsed.sn}, MAC: ${parsed.mac}`);
      } catch (e) {}
    }

    // Get current format
    const currentFormat = formats[formatIndex % formats.length];
    formatIndex++;

    console.log(`\n🧪 Using: ${currentFormat.name}`);

    let responseData = currentFormat.response;

    // For register endpoint, add device-specific fields if format supports it
    if (
      req.url.includes("/register") &&
      responseData.data &&
      typeof responseData.data === "object"
    ) {
      responseData = {
        ...responseData,
        data: {
          ...responseData.data,
          deviceId: "CFE9FA280014",
          deviceKey: "test_key_" + Date.now(),
        },
      };
    }

    const responseBody = JSON.stringify(responseData);
    console.log(`Response:`, responseBody);
    console.log(`Length: ${responseBody.length} bytes`);

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(responseBody),
      Connection: "close",
    });
    res.end(responseBody);

    console.log(
      `✅ Sent (Format ${
        formatIndex % formats.length === 0
          ? formats.length
          : formatIndex % formats.length
      })`
    );
    console.log(`${"=".repeat(70)}\n`);

    console.log(
      `💡 TIP: Try WiFi config again to test next format, or restart server to reset format index`
    );
  });
});

const PORT = 8000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Format testing server running on http://0.0.0.0:${PORT}`);
  console.log(
    `\nThis server will try different response formats on each request.`
  );
  console.log(`Try WiFi configuration multiple times to test all formats.\n`);
});
