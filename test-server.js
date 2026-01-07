// test-server.js - Diagnostic server to find correct response format
const http = require("http");

const server = http.createServer((req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  console.log(`Headers:`, JSON.stringify(req.headers, null, 2));

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    if (body) {
      console.log(`Body:`, body);
      try {
        const parsed = JSON.parse(body);
        console.log(`Parsed JSON:`, JSON.stringify(parsed, null, 2));
        console.log(`Device SN: ${parsed.sn}`);
        console.log(`Device MAC: ${parsed.mac}`);
      } catch (e) {
        console.log(`(Could not parse as JSON)`);
      }
    }

    // Try Format 1: Minimal with code/message/data
    let responseData;

    if (req.url.includes("/register")) {
      console.log(`\n📝 Testing Format 1: Minimal response`);
      responseData = {
        code: 0,
        message: "success",
        data: {},
      };
    } else if (req.url.includes("/config")) {
      responseData = {
        code: 0,
        message: "success",
        data: {},
      };
    } else {
      responseData = {
        code: 0,
        message: "success",
        data: {},
      };
    }

    const responseBody = JSON.stringify(responseData);
    console.log(`Response JSON:`, responseBody);
    console.log(`Response length: ${responseBody.length} bytes`);
    console.log(`Response bytes:`, Buffer.from(responseBody).toString("hex"));

    // Send response
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(responseBody),
      Connection: "close",
    });
    res.end(responseBody);

    console.log(`✅ Response sent (HTTP 200)`);
    console.log(`${"=".repeat(60)}\n`);
  });

  req.on("error", (err) => {
    console.error("Request error:", err);
  });
});

server.on("error", (err) => {
  console.error("Server error:", err);
});

const PORT = 8000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Diagnostic server running on http://0.0.0.0:${PORT}`);
  console.log(`Waiting for scale to connect...\n`);
  console.log(
    `This server will log EVERYTHING to help debug the response format.\n`
  );
});
