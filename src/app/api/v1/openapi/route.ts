/**
 * Serves a real OpenAPI 3.1 document describing the public v1 REST API.
 * Public (no API key needed to read the spec itself).
 */

const PAGINATION_PARAMS = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
];

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } },
      required: ["code", "message"],
    },
  },
  required: ["error"],
};

function paginatedResponse(itemSchemaRef: string) {
  return {
    description: "A page of results.",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: itemSchemaRef } },
            pagination: {
              type: "object",
              properties: {
                page: { type: "integer" },
                pageSize: { type: "integer" },
                total: { type: "integer" },
                totalPages: { type: "integer" },
              },
            },
          },
        },
      },
    },
  };
}

function itemResponse(itemSchemaRef: string) {
  return {
    description: "A single resource.",
    content: { "application/json": { schema: { type: "object", properties: { data: { $ref: itemSchemaRef } } } } },
  };
}

function listPath(summary: string, tag: string, itemSchemaRef: string, extraParams: Record<string, unknown>[] = []) {
  return {
    get: {
      summary,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      parameters: [...PAGINATION_PARAMS, ...extraParams],
      responses: {
        "200": paginatedResponse(itemSchemaRef),
        "401": { description: "Missing or invalid API key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "The API key lacks the required scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "429": { description: "Rate limit exceeded.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  };
}

function itemPath(summary: string, tag: string, itemSchemaRef: string) {
  return {
    get: {
      summary,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": itemResponse(itemSchemaRef),
        "401": { description: "Missing or invalid API key." },
        "403": { description: "The API key lacks the required scope." },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  };
}

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "FSW Academy Public API",
    version: "1.0.0",
    description:
      "Read (and, for assignments, write) access to people, training, and compliance records. Authenticate with an API key created in Admin → Integrations, sent as `Authorization: Bearer fsw_...`. Every key is scoped to specific permissions; a request for data outside those scopes returns 403.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ ApiKeyAuth: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "http", scheme: "bearer", bearerFormat: "fsw_<random>" },
    },
    schemas: {
      Error: ERROR_SCHEMA,
      Person: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          employeeId: { type: "string", nullable: true },
          title: { type: "string", nullable: true },
          status: { type: "string", enum: ["INVITED", "ACTIVE", "INACTIVE"] },
          workerType: { type: "string" },
          country: { type: "string" },
          startDate: { type: "string", format: "date-time", nullable: true },
        },
      },
      Course: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          category: { type: "string", nullable: true },
          difficulty: { type: "string" },
          status: { type: "string" },
          estimatedMinutes: { type: "integer", nullable: true },
          passingScore: { type: "integer", nullable: true },
        },
      },
      Sop: {
        type: "object",
        properties: {
          id: { type: "string" },
          sopCode: { type: "string" },
          kind: { type: "string", enum: ["SOP", "POLICY"] },
          title: { type: "string" },
          summary: { type: "string", nullable: true },
          category: { type: "string", nullable: true },
          status: { type: "string" },
          nextReviewAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      Assignment: {
        type: "object",
        properties: {
          id: { type: "string" },
          userId: { type: "string" },
          targetType: { type: "string", enum: ["COURSE", "SOP", "LEARNING_PATH"] },
          status: { type: "string", enum: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "OVERDUE", "WAIVED", "EXPIRED"] },
          dueAt: { type: "string", format: "date-time", nullable: true },
          completedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      AssignmentCreate: {
        type: "object",
        required: ["userId", "targetType"],
        properties: {
          userId: { type: "string" },
          targetType: { type: "string", enum: ["COURSE", "SOP", "LEARNING_PATH"] },
          courseId: { type: "string" },
          sopId: { type: "string" },
          pathId: { type: "string" },
          dueAt: { type: "string", format: "date-time" },
          reason: { type: "string" },
        },
      },
      Completion: {
        type: "object",
        properties: {
          id: { type: "string" },
          userId: { type: "string" },
          targetType: { type: "string" },
          title: { type: "string" },
          scorePercent: { type: "number", nullable: true },
          completedAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          certificateNumber: { type: "string", nullable: true },
        },
      },
      Skill: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          category: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
        },
      },
      Certification: {
        type: "object",
        properties: {
          id: { type: "string" },
          certificateNumber: { type: "string" },
          userId: { type: "string" },
          courseTitle: { type: "string" },
          issuedAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", enum: ["VALID", "EXPIRED", "REVOKED"] },
        },
      },
    },
  },
  paths: {
    "/people": listPath("List people", "People", "#/components/schemas/Person", [
      { name: "status", in: "query", schema: { type: "string" } },
      { name: "departmentId", in: "query", schema: { type: "string" } },
      { name: "email", in: "query", schema: { type: "string" } },
    ]),
    "/people/{id}": itemPath("Get a person", "People", "#/components/schemas/Person"),
    "/courses": listPath("List courses", "Courses", "#/components/schemas/Course", [
      { name: "status", in: "query", schema: { type: "string", default: "PUBLISHED" } },
      { name: "category", in: "query", schema: { type: "string" } },
    ]),
    "/courses/{id}": itemPath("Get a course", "Courses", "#/components/schemas/Course"),
    "/sops": listPath("List SOPs and policies", "SOPs", "#/components/schemas/Sop", [
      { name: "status", in: "query", schema: { type: "string", default: "PUBLISHED" } },
      { name: "kind", in: "query", schema: { type: "string", enum: ["SOP", "POLICY"] } },
    ]),
    "/sops/{id}": itemPath("Get a SOP", "SOPs", "#/components/schemas/Sop"),
    "/assignments": {
      ...listPath("List assignments", "Assignments", "#/components/schemas/Assignment", [
        { name: "userId", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string" } },
      ]),
      post: {
        summary: "Assign training to a person",
        tags: ["Assignments"],
        security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AssignmentCreate" } } } },
        responses: {
          "201": { description: "Created.", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Assignment" } } } } } },
          "400": { description: "Invalid input.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or invalid API key." },
          "403": { description: "The API key lacks the training.assign scope." },
        },
      },
    },
    "/assignments/{id}": itemPath("Get an assignment", "Assignments", "#/components/schemas/Assignment"),
    "/completions": listPath("List training completions", "Completions", "#/components/schemas/Completion", [
      { name: "userId", in: "query", schema: { type: "string" } },
      { name: "courseId", in: "query", schema: { type: "string" } },
      { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
    ]),
    "/completions/{id}": itemPath("Get a completion record", "Completions", "#/components/schemas/Completion"),
    "/skills": listPath("List the skill catalog (or one person's levels with ?userId=)", "Skills", "#/components/schemas/Skill", [
      { name: "userId", in: "query", schema: { type: "string" } },
    ]),
    "/skills/{id}": itemPath("Get a skill", "Skills", "#/components/schemas/Skill"),
    "/certifications": listPath("List issued certificates", "Certifications", "#/components/schemas/Certification", [
      { name: "userId", in: "query", schema: { type: "string" } },
      { name: "status", in: "query", schema: { type: "string", enum: ["VALID", "EXPIRED", "REVOKED"] } },
    ]),
    "/certifications/{id}": itemPath("Get a certificate", "Certifications", "#/components/schemas/Certification"),
  },
};

export async function GET(): Promise<Response> {
  return Response.json(openApiDocument);
}
