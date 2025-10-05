const API_ENDPOINT = '/.netlify/functions/surveys';
const STORAGE_KEY = 'surveyFingerprint';

const state = {
  isAdmin: false,
  adminCredentials: null,
  surveys: [],
  fingerprint: null,
  firstSeen: null,
  loading: false,
};

const loginForm = document.getElementById('login-form');
const logoutButton = document.getElementById('logout-button');
const loginFeedback = document.getElementById('login-feedback');
const content = document.getElementById('content');
const toast = document.getElementById('toast');

loginForm.addEventListener('submit', handleLogin);
logoutButton.addEventListener('click', handleLogout);

init();

async function init() {
  const identity = await ensureFingerprint();
  state.fingerprint = identity.id;
  state.firstSeen = identity.firstSeen;
  await refreshSurveys();
  render();
}

async function ensureFingerprint() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      return JSON.parse(existing);
    }
  } catch (error) {
    console.warn('No se pudo acceder a localStorage', error);
  }

  const firstSeen = new Date().toISOString();
  const userAgent = navigator.userAgent || 'unknown-ua';
  const language = navigator.language || 'es';
  const platform = navigator.platform || 'unknown-platform';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const screenInfo = `${screen.width}x${screen.height}`;
  const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
  const rawFingerprint = [userAgent, language, platform, timezone, screenInfo, firstSeen, seed].join('|');
  const id = await hashString(rawFingerprint);
  const payload = { id, firstSeen };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Fingerprint no persistido', error);
  }

  return payload;
}

async function hashString(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function refreshSurveys() {
  try {
    const payload = {
      action: 'list',
      fingerprint: state.fingerprint,
      firstSeen: state.firstSeen,
    };

    if (state.isAdmin && state.adminCredentials) {
      payload.adminUser = state.adminCredentials.user;
      payload.adminPass = state.adminCredentials.pass;
    }

    const data = await callApi(payload);
    state.surveys = data.surveys || [];

    if (!data.isAdmin && state.isAdmin) {
      showToast('Sesión docente expirada. Vuelve a iniciar sesión.');
      state.isAdmin = false;
      state.adminCredentials = null;
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo cargar la información');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const user = (formData.get('user') || '').trim();
  const password = (formData.get('password') || '').trim();

  if (!user || !password) {
    loginFeedback.textContent = 'Introduce usuario y contraseña.';
    return;
  }

  loginFeedback.textContent = 'Validando credenciales…';

  try {
    const data = await callApi({
      action: 'list',
      fingerprint: state.fingerprint,
      firstSeen: state.firstSeen,
      adminUser: user,
      adminPass: password,
    });

    if (data.isAdmin) {
      state.isAdmin = true;
      state.adminCredentials = { user, pass: password };
      state.surveys = data.surveys || [];
      loginFeedback.textContent = 'Sesión docente activa.';
      showToast('Has accedido como docente.');
      render();
      return;
    }

    loginFeedback.textContent = 'Credenciales incorrectas.';
  } catch (error) {
    console.error(error);
    loginFeedback.textContent = error.message || 'No se pudo iniciar sesión.';
  }
}

async function handleLogout() {
  if (!state.isAdmin) {
    loginFeedback.textContent = 'Sesión visitante activa.';
    return;
  }

  state.isAdmin = false;
  state.adminCredentials = null;
  loginFeedback.textContent = 'Sesión cerrada.';
  await refreshSurveys();
  render();
}

function render() {
  if (state.isAdmin) {
    renderAdminView();
  } else {
    renderParticipantView();
  }
}

function renderAdminView() {
  const intro = `
    <section>
      <h2 class="section-title">Panel docente</h2>
      <form id="create-survey-form">
        <fieldset>
          <legend>Nueva encuesta</legend>
          <label>
            Título
            <input name="title" type="text" placeholder="Encuesta rápida" required />
          </label>
          <label>
            Pregunta
            <textarea name="question" placeholder="¿Qué opción prefieres?" required></textarea>
          </label>
          <label>
            Opciones (separadas por salto de línea)
            <textarea name="options" placeholder="Opción A\nOpción B" required></textarea>
          </label>
          <button class="primary" type="submit">Publicar encuesta</button>
        </fieldset>
      </form>
    </section>`;

  const surveyCards = state.surveys.length
    ? state.surveys
        .map((survey) => renderAdminSurveyCard(survey))
        .join('')
    : '<p class="meta">No hay encuestas todavía.</p>';

  content.innerHTML = `${intro}<section><h2 class="section-title">Encuestas creadas</h2>${surveyCards}</section>`;

  const createSurveyForm = document.getElementById('create-survey-form');
  createSurveyForm.addEventListener('submit', handleCreateSurvey);

  document.querySelectorAll('[data-action="close"]')
    .forEach((button) => button.addEventListener('click', handleCloseSurvey));
}

function renderParticipantView() {
  const available = state.surveys.filter((survey) => survey.status === 'open');
  const closed = state.surveys.filter((survey) => survey.status !== 'open');

  const openSection = available.length
    ? available.map((survey) => renderParticipantSurveyCard(survey)).join('')
    : '<p class="meta">No hay encuestas abiertas en este momento.</p>';

  const closedSection = closed.length
    ? `<details><summary>Encuestas cerradas</summary>${closed
        .map((survey) => renderSummarySurveyCard(survey))
        .join('')}</details>`
    : '';

  content.innerHTML = `
    <section>
      <h2 class="section-title">Encuestas disponibles</h2>
      ${openSection}
    </section>
    ${closedSection}
  `;

  document.querySelectorAll('form[data-survey]')
    .forEach((form) => form.addEventListener('submit', handleSubmitVote));
}

function renderAdminSurveyCard(survey) {
  const total = survey.totalResponses || 0;
  const optionsMarkup = survey.options
    .map((option, index) => {
      const votes = survey.totals?.[index] ?? 0;
      const percentage = total ? Math.round((votes / total) * 100) : 0;
      return `
        <li>
          <strong>${option}</strong>
          <div class="meta">${votes} votos (${percentage}%)</div>
          <div class="result-bar"><span style="width:${percentage}%;"></span></div>
        </li>`;
    })
    .join('');

  const statusLabel = survey.status === 'open' ? 'Abierta' : 'Cerrada';
  return `
    <article class="card" data-id="${survey.id}">
      <div class="card-header">
        <div>
          <h3>${survey.title}</h3>
          <p class="meta">${survey.question}</p>
        </div>
        <span class="chip ${survey.status}">${statusLabel}</span>
      </div>
      <ul class="options-list">${optionsMarkup}</ul>
      <p class="meta">Respuestas totales: ${total}</p>
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        ${survey.status === 'open'
          ? `<button class="danger" data-action="close" data-id="${survey.id}">Cerrar encuesta</button>`
          : ''}
      </div>
    </article>`;
}

function renderParticipantSurveyCard(survey) {
  if (survey.hasResponded) {
    return renderSummarySurveyCard(survey, true);
  }

  const optionsMarkup = survey.options
    .map((option, index) => `
      <label>
        <input type="radio" name="option-${survey.id}" value="${index}" required />
        ${option}
      </label>`)
    .join('');

  return `
    <article class="card">
      <div class="card-header">
        <div>
          <h3>${survey.title}</h3>
          <p class="meta">${survey.question}</p>
        </div>
        <span class="chip open">Abierta</span>
      </div>
      <form data-survey="${survey.id}">
        <div class="options-list">${optionsMarkup}</div>
        <button class="primary" type="submit">Enviar respuesta</button>
      </form>
    </article>`;
}

function renderSummarySurveyCard(survey, answered = false) {
  const total = survey.totalResponses || 0;
  const statusLabel = survey.status === 'open' ? 'Abierta' : 'Cerrada';
  const optionsMarkup = survey.options
    .map((option, index) => {
      const votes = survey.totals?.[index] ?? 0;
      const percentage = total ? Math.round((votes / total) * 100) : 0;
      return `
        <li>
          <strong>${option}</strong>
          <div class="meta">${votes} votos (${percentage}%)</div>
          <div class="result-bar"><span style="width:${percentage}%;"></span></div>
        </li>`;
    })
    .join('');

  const notice = answered
    ? '<p class="meta">Ya participaste en esta encuesta.</p>'
    : '';

  return `
    <article class="card">
      <div class="card-header">
        <div>
          <h3>${survey.title}</h3>
          <p class="meta">${survey.question}</p>
        </div>
        <span class="chip ${survey.status}">${statusLabel}</span>
      </div>
      ${notice}
      <ul class="options-list">${optionsMarkup}</ul>
      <p class="meta">Respuestas totales: ${total}</p>
    </article>`;
}

async function handleCreateSurvey(event) {
  event.preventDefault();
  if (!state.isAdmin || !state.adminCredentials) {
    showToast('La sesión docente no es válida.');
    return;
  }

  const formData = new FormData(event.target);
  const title = (formData.get('title') || '').trim();
  const question = (formData.get('question') || '').trim();
  const optionsText = (formData.get('options') || '').trim();
  const options = optionsText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!title || !question || options.length < 2) {
    showToast('Incluye al menos dos opciones.');
    return;
  }

  try {
    await callApi({
      action: 'create',
      adminUser: state.adminCredentials.user,
      adminPass: state.adminCredentials.pass,
      payload: { title, question, options },
    });

    showToast('Encuesta creada.');
    event.target.reset();
    await refreshSurveys();
    render();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo crear la encuesta.');
  }
}

async function handleCloseSurvey(event) {
  const button = event.currentTarget;
  const surveyId = button.dataset.id;
  if (!surveyId) return;

  try {
    await callApi({
      action: 'close',
      adminUser: state.adminCredentials.user,
      adminPass: state.adminCredentials.pass,
      payload: { surveyId },
    });

    showToast('Encuesta cerrada.');
    await refreshSurveys();
    render();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo cerrar la encuesta.');
  }
}

async function handleSubmitVote(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const surveyId = form.dataset.survey;
  const formData = new FormData(form);
  const optionValue = formData.get(`option-${surveyId}`);

  if (typeof optionValue === 'undefined' || optionValue === null) {
    showToast('Selecciona una opción.');
    return;
  }

  try {
    await callApi({
      action: 'submit',
      fingerprint: state.fingerprint,
      firstSeen: state.firstSeen,
      payload: {
        surveyId,
        optionIndex: Number(optionValue),
      },
    });

    showToast('Respuesta registrada.');
    await refreshSurveys();
    render();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo registrar la respuesta.');
  }
}

async function callApi(body) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    const message = data?.message || `Error ${response.status}`;
    throw new Error(message);
  }

  return data;
}

let toastTimeout;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, 3200);
}
