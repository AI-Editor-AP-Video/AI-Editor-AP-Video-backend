import type { FastifyRequest } from "fastify";
import { type AnyZodObject } from "zod";

export function validateSchema(schema: {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
}) {
  return async (req: FastifyRequest) => {
    if (schema.body && req.body) {
      req.body = await schema.body.parseAsync(req.body);
    }
    if (schema.query && req.query) {
      req.query = await schema.query.parseAsync(req.query);
    }
    if (schema.params && req.params) {
      req.params = await schema.params.parseAsync(req.params);
    }
  };
}
