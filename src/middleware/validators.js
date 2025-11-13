function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'ValidationError', details: result.error.issues });
    }
    req.validatedBody = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ error: 'ValidationError', details: result.error.issues });
    }
    req.validatedQuery = result.data;
    return next();
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({ error: 'ValidationError', details: result.error.issues });
    }
    req.validatedParams = result.data;
    return next();
  };
}

module.exports = { validateBody, validateQuery, validateParams };


