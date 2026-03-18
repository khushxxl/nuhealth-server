/**
 * Standardized API response helpers.
 * Matches existing server response format: { errorCode, text, data }
 */

function success(res, data, text = "Success", statusCode = 200) {
  return res.status(statusCode).json({
    errorCode: 0,
    text,
    data,
  });
}

function error(res, text = "Internal server error", statusCode = 500) {
  return res.status(statusCode).json({
    errorCode: 1,
    text,
    data: null,
  });
}

module.exports = { success, error };
