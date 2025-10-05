import { createClient } from '@netlify/blobs';
import { randomUUID } from 'crypto';

const ADMIN_USER = 'ximo';
const ADMIN_PASS = 'p4$$w0rd';
const STORE_NAME = 'class-surveys';
const STORE_KEY = 'surveys.json';

const blobClient = createClient({
  name: STORE_NAME,
  siteId: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_BLOBS_TOKEN,
});

const baseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...baseHeaders,
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Método no permitido' });
  }

  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    return jsonResponse(400, { message: 'JSON inválido' });
  }

  const action = body.action;
  if (!action) {
    return jsonResponse(400, { message: 'La acción es obligatoria' });
  }

  const isAdmin = validateAdmin(body.adminUser, body.adminPass);

  try {
    switch (action) {
      case 'list':
        return jsonResponse(200, await handleList({
          isAdmin,
          fingerprint: body.fingerprint,
          firstSeen: body.firstSeen,
        }));
      case 'create':
        return await handleCreate({
          isAdmin,
          payload: body.payload,
        });
      case 'close':
        return await handleClose({
          isAdmin,
          payload: body.payload,
        });
      case 'submit':
        return await handleSubmit({
          fingerprint: body.fingerprint,
          firstSeen: body.firstSeen,
          payload: body.payload,
        });
      default:
        return jsonResponse(400, { message: 'Acción desconocida' });
    }
  } catch (error) {
    console.error('Surveys function error:', error);
    return jsonResponse(500, { message: 'Error interno' });
  }
};

function validateAdmin(user, pass) {
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

async function handleList({ isAdmin, fingerprint }) {
  const data = await readStore();
  const surveys = data.surveys.map((survey) => serializeSurvey(survey, { isAdmin, fingerprint }));
  return { surveys, isAdmin };
}

async function handleCreate({ isAdmin, payload }) {
  if (!isAdmin) {
    return jsonResponse(401, { message: 'No autorizado' });
  }

  const { title, question, options } = payload || {};
  const cleanTitle = sanitizeText(title);
  const cleanQuestion = sanitizeText(question);
  const normalizedOptions = Array.isArray(options)
    ? options.map(sanitizeText).filter(Boolean)
    : [];

  if (!cleanTitle || !cleanQuestion || normalizedOptions.length < 2) {
    return jsonResponse(400, { message: 'Completa título, pregunta y al menos dos opciones.' });
  }

  const data = await readStore();
  const newSurvey = {
    id: randomUUID(),
    title: cleanTitle,
    question: cleanQuestion,
    options: normalizedOptions,
    status: 'open',
    createdAt: new Date().toISOString(),
    closedAt: null,
    responses: [],
  };

  data.surveys.unshift(newSurvey);
  await writeStore(data);

  return jsonResponse(201, {
    survey: serializeSurvey(newSurvey, { isAdmin: true }),
  });
}

async function handleClose({ isAdmin, payload }) {
  if (!isAdmin) {
    return jsonResponse(401, { message: 'No autorizado' });
  }

  const surveyId = payload?.surveyId;
  if (!surveyId) {
    return jsonResponse(400, { message: 'Identificador requerido.' });
  }

  const data = await readStore();
  const survey = data.surveys.find((item) => item.id === surveyId);
  if (!survey) {
    return jsonResponse(404, { message: 'Encuesta no encontrada.' });
  }

  if (survey.status !== 'closed') {
    survey.status = 'closed';
    survey.closedAt = new Date().toISOString();
    await writeStore(data);
  }

  return jsonResponse(200, {
    survey: serializeSurvey(survey, { isAdmin: true }),
  });
}

async function handleSubmit({ fingerprint, firstSeen, payload }) {
  if (!fingerprint) {
    return jsonResponse(400, { message: 'Fingerprint requerido.' });
  }

  const surveyId = payload?.surveyId;
  const optionIndex = payload?.optionIndex;

  if (!surveyId || typeof optionIndex !== 'number') {
    return jsonResponse(400, { message: 'Encuesta y opción obligatorias.' });
  }

  const data = await readStore();
  const survey = data.surveys.find((item) => item.id === surveyId);
  if (!survey) {
    return jsonResponse(404, { message: 'Encuesta no encontrada.' });
  }

  if (survey.status !== 'open') {
    return jsonResponse(409, { message: 'La encuesta no está abierta.' });
  }

  if (optionIndex < 0 || optionIndex >= survey.options.length) {
    return jsonResponse(400, { message: 'Opción inválida.' });
  }

  const alreadyAnswered = survey.responses.some((response) => response.fingerprint === fingerprint);
  if (alreadyAnswered) {
    return jsonResponse(409, { message: 'Ya has respondido a esta encuesta.' });
  }

  survey.responses.push({
    fingerprint,
    optionIndex,
    firstSeen: firstSeen || null,
    timestamp: new Date().toISOString(),
  });

  await writeStore(data);

  return jsonResponse(200, {
    survey: serializeSurvey(survey, { isAdmin: false, fingerprint }),
    message: 'Respuesta registrada',
  });
}

async function readStore() {
  try {
    const stored = await blobClient.getJSON(STORE_KEY);
    if (!stored || !Array.isArray(stored.surveys)) {
      return { surveys: [] };
    }
    return stored;
  } catch (error) {
    if (error.status === 404) {
      return { surveys: [] };
    }
    throw error;
  }
}

async function writeStore(data) {
  await blobClient.setJSON(STORE_KEY, data);
}

function serializeSurvey(survey, { isAdmin, fingerprint }) {
  const totals = survey.options.map((_, index) =>
    survey.responses.reduce((count, response) => (response.optionIndex === index ? count + 1 : count), 0)
  );

  const totalResponses = totals.reduce((acc, value) => acc + value, 0);
  const hasResponded = fingerprint
    ? survey.responses.some((response) => response.fingerprint === fingerprint)
    : false;

  const base = {
    id: survey.id,
    title: survey.title,
    question: survey.question,
    options: survey.options,
    status: survey.status,
    createdAt: survey.createdAt,
    closedAt: survey.closedAt,
    totals,
    totalResponses,
    hasResponded,
  };

  if (isAdmin) {
    base.responses = survey.responses;
  }

  return base;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: baseHeaders,
    body: JSON.stringify(body),
  };
}

function sanitizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}
