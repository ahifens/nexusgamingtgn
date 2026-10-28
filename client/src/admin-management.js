function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

async function api(path, { method = 'GET', body, csrfToken } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'No se pudo completar la operación.');
  return data;
}

function statusBadge(status) {
  const label = { open: 'Abierto', closed: 'Cerrado', completed: 'Finalizado' }[status] ?? status;
  return node('span', `status-label status-${status === 'open' || status === 'completed' ? 'published' : 'draft'}`, label);
}

function formatTournamentInput(form, tournament) {
  form.elements.title.value = tournament.title;
  form.elements.game.value = tournament.game;
  form.elements.startsOn.value = tournament.startsOn;
  form.elements.startsAt.value = tournament.startsAt;
  form.elements.format.value = tournament.format;
  form.elements.capacity.value = tournament.capacity;
  form.elements.entryFeeEuros.value = (tournament.entryFeeCents / 100).toFixed(2);
  form.elements.prize.value = tournament.prize;
  form.elements.rules.value = tournament.rules;
  form.elements.status.value = tournament.status;
}

export function setupAdminManagement({ csrfToken, role }) {
  const tabs = [...document.querySelectorAll('[data-admin-tab]')];
  const form = document.querySelector('#tournament-form');
  const tournamentList = document.querySelector('#admin-tournament-list');
  const reservationsList = document.querySelector('#admin-reservation-list');
  const membersList = document.querySelector('#admin-member-list');
  const ideasList = document.querySelector('#admin-idea-list');
  let editingTournamentId = null;

  if (role !== 'administrator') {
    tabs.filter((tab) => ['tournaments', 'members'].includes(tab.dataset.adminTab)).forEach((tab) => { tab.hidden = true; });
  }

  async function loadEntries(tournament) {
    const target = document.querySelector('#tournament-entries');
    target.hidden = false;
    target.replaceChildren(node('p', 'list-loading', 'Cargando participantes…'));
    try {
      const { entries } = await api(`/api/admin/tournaments/${tournament.id}/entries`);
      target.replaceChildren(node('h3', '', `Participantes · ${tournament.title}`));
      if (!entries.length) {
        target.append(node('p', 'list-empty', 'Todavía no hay inscripciones.'));
        return;
      }
      const registered = entries.filter((entry) => entry.status === 'registered');
      if (registered.length) {
        const resultList = node('div', 'result-entry-list');
        registered.forEach((entry, index) => {
          const row = node('div', 'result-entry-row');
          row.dataset.gamertag = entry.gamertag;
          row.append(node('strong', '', entry.gamertag), node('span', '', entry.name));
          const placement = node('input');
          placement.type = 'number';
          placement.min = '1';
          placement.max = String(tournament.capacity);
          placement.value = String(entry.placement ?? index + 1);
          placement.setAttribute('aria-label', `Posición de ${entry.gamertag}`);
          const points = node('input');
          points.type = 'number';
          points.min = '0';
          points.value = String(entry.points ?? [100, 60, 40, 25, 10][index] ?? 0);
          points.setAttribute('aria-label', `Puntos de ${entry.gamertag}`);
          row.append(placement, points);
          resultList.append(row);
        });
        const saveResults = node('button', 'admin-button admin-button-dark', 'Guardar resultados y actualizar ranking');
        saveResults.type = 'button';
        saveResults.addEventListener('click', async () => {
          const results = [...resultList.querySelectorAll('.result-entry-row')].map((row) => ({
            gamertag: row.dataset.gamertag,
            placement: Number(row.querySelectorAll('input')[0].value),
            points: Number(row.querySelectorAll('input')[1].value),
          }));
          try {
            await api(`/api/admin/tournaments/${tournament.id}/results`, {
              method: 'POST',
              body: { results },
              csrfToken,
            });
            document.querySelector('#tournament-message').textContent = 'Resultados guardados y ranking actualizado.';
            await loadTournaments();
            await loadEntries({ ...tournament, status: 'completed' });
          } catch (error) {
            document.querySelector('#tournament-message').textContent = error.message;
          }
        });
        target.append(resultList, saveResults);
      }
      const waitlisted = entries.filter((entry) => entry.status === 'waitlisted');
      if (waitlisted.length) {
        target.append(node('h4', '', 'Lista de espera'));
        waitlisted.forEach((entry) => target.append(node('p', 'waitlist-entry', `${entry.gamertag} · ${entry.name}`)));
      }
    } catch (error) {
      target.replaceChildren(node('p', 'list-empty', error.message));
    }
  }

  async function loadTournaments() {
    tournamentList.replaceChildren(node('p', 'list-loading', 'Cargando torneos…'));
    try {
      const { tournaments } = await api('/api/admin/tournaments');
      document.querySelector('#tournament-count').textContent = String(tournaments.length).padStart(2, '0');
      tournamentList.replaceChildren();
      if (!tournaments.length) tournamentList.append(node('p', 'list-empty', 'Todavía no hay torneos.'));
      tournaments.forEach((tournament) => {
        const row = node('article', 'admin-news-row');
        const info = node('div', 'admin-news-headline');
        info.append(statusBadge(tournament.status));
        info.append(node('h3', '', tournament.title));
        info.append(node('p', '', `${tournament.game} · ${tournament.startsOn} ${tournament.startsAt} · ${tournament.registeredCount}/${tournament.capacity} plazas`));
        info.append(node('p', '', `Lista de espera: ${tournament.waitlistCount} · Inscripción: ${(tournament.entryFeeCents / 100).toFixed(2)} €`));
        const actions = node('div', 'admin-news-actions');
        const edit = node('button', 'news-action', 'Editar');
        edit.type = 'button';
        edit.addEventListener('click', () => {
          editingTournamentId = tournament.id;
          formatTournamentInput(form, tournament);
          document.querySelector('#tournament-editor-title').textContent = 'Editar torneo';
          document.querySelector('#reset-tournament').hidden = false;
          form.elements.title.focus();
        });
        const entries = node('button', 'news-action', 'Participantes / resultados');
        entries.type = 'button';
        entries.addEventListener('click', () => loadEntries(tournament));
        actions.append(edit, entries);
        if (tournament.status !== 'completed') {
          const toggle = node('button', 'news-action', tournament.status === 'open' ? 'Cerrar inscripciones' : 'Abrir inscripciones');
          toggle.type = 'button';
          toggle.addEventListener('click', async () => {
            try {
              await api(`/api/admin/tournaments/${tournament.id}`, {
                method: 'PUT',
                body: { ...tournament, status: tournament.status === 'open' ? 'closed' : 'open' },
                csrfToken,
              });
              await loadTournaments();
            } catch (error) {
              document.querySelector('#tournament-message').textContent = error.message;
            }
          });
          actions.append(toggle);
        }
        const remove = node('button', 'news-action news-action-delete', 'Eliminar');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          const entryCount = tournament.registeredCount + tournament.waitlistCount;
          const warning = entryCount ? ` Se eliminarán también ${entryCount} inscripciones y sus resultados.` : '';
          if (!confirm(`¿Eliminar «${tournament.title}»?${warning}`)) return;
          try {
            await api(`/api/admin/tournaments/${tournament.id}`, { method: 'DELETE', csrfToken });
            await loadTournaments();
          } catch (error) {
            document.querySelector('#tournament-message').textContent = error.message;
          }
        });
        actions.append(remove);
        row.append(info, actions);
        tournamentList.append(row);
      });
    } catch (error) {
      tournamentList.replaceChildren(node('p', 'list-empty', error.message));
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.capacity = Number(values.capacity);
    values.entryFeeCents = Math.round(Number(values.entryFeeEuros) * 100);
    delete values.entryFeeEuros;
    const url = editingTournamentId ? `/api/admin/tournaments/${editingTournamentId}` : '/api/admin/tournaments';
    try {
      await api(url, { method: editingTournamentId ? 'PUT' : 'POST', body: values, csrfToken });
      document.querySelector('#tournament-message').textContent = editingTournamentId ? 'Torneo actualizado.' : 'Torneo creado.';
      resetTournament();
      await loadTournaments();
    } catch (error) {
      document.querySelector('#tournament-message').textContent = error.message;
    }
  });

  function resetTournament() {
    editingTournamentId = null;
    form.reset();
    form.elements.capacity.value = '16';
    form.elements.entryFeeEuros.value = '0';
    form.elements.status.value = 'open';
    document.querySelector('#tournament-editor-title').textContent = 'Añadir torneo';
    document.querySelector('#reset-tournament').hidden = true;
  }

  document.querySelector('#reset-tournament').addEventListener('click', resetTournament);

  async function loadReservations() {
    reservationsList.replaceChildren(node('p', 'list-loading', 'Cargando reservas…'));
    try {
      const { reservations } = await api('/api/admin/reservations');
      reservationsList.replaceChildren();
      if (!reservations.length) reservationsList.append(node('p', 'list-empty', 'Todavía no hay reservas.'));
      reservations.forEach((reservation) => {
        const row = node('article', 'admin-news-row');
        const info = node('div', 'admin-news-headline');
        info.append(statusBadge(reservation.status), node('h3', '', `${reservation.customerName} · ${reservation.date} ${reservation.startTime}`));
        info.append(node('p', '', `${reservation.code} · ${reservation.customerEmail} · ${(reservation.totalCents / 100).toFixed(2)} €${reservation.memberName ? ` · Cuenta: ${reservation.memberName}` : ''}`));
        const actions = node('div', 'admin-news-actions');
        const status = node('select', 'reservation-status-select');
        status.setAttribute('aria-label', `Estado de reserva ${reservation.code}`);
        [['pending', 'Pendiente'], ['confirmed', 'Confirmada'], ['completed', 'Completada'], ['cancelled', 'Cancelada'], ['no_show', 'No presentado']].forEach(([value, label]) => {
          const option = node('option', '', label);
          option.value = value;
          option.selected = value === reservation.status;
          status.append(option);
        });
        const save = node('button', 'news-action', 'Guardar estado');
        save.type = 'button';
        save.addEventListener('click', async () => {
          try {
            await api(`/api/admin/reservations/${reservation.id}/status`, { method: 'PATCH', body: { status: status.value }, csrfToken });
            await loadReservations();
          } catch (error) {
            reservationsList.prepend(node('p', 'form-message', error.message));
          }
        });
        actions.append(status, save);
        row.append(info, actions);
        reservationsList.append(row);
      });
    } catch (error) {
      reservationsList.replaceChildren(node('p', 'list-empty', error.message));
    }
  }

  async function loadMembers() {
    membersList.replaceChildren(node('p', 'list-loading', 'Cargando cuentas…'));
    try {
      const { members } = await api('/api/admin/members');
      membersList.replaceChildren();
      if (!members.length) membersList.append(node('p', 'list-empty', 'Todavía no hay cuentas públicas.'));
      members.forEach((member) => {
        const row = node('article', 'admin-news-row');
        const info = node('div', 'admin-news-headline');
        const isActive = Boolean(member.active);
        info.append(node('span', `status-label status-${isActive ? 'published' : 'draft'}`, isActive ? 'Activa' : 'Baneada'));
        info.append(node('h3', '', member.displayName), node('p', '', `${member.email} · ${member.points} puntos`));
        const actions = node('div', 'admin-news-actions');
        const roleSelect = node('select', 'member-role-select');
        roleSelect.setAttribute('aria-label', `Rol de ${member.displayName}`);
        roleSelect.disabled = !isActive;
        [['user', 'Usuario'], ['moderator', 'Moderador'], ['administrator', 'Administrador']].forEach(([value, label]) => {
          const option = node('option', '', label);
          option.value = value;
          option.selected = value === member.role;
          roleSelect.append(option);
        });
        const save = node('button', 'news-action', 'Guardar rol');
        save.type = 'button';
        save.disabled = !isActive;
        save.addEventListener('click', async () => {
          try {
            await api(`/api/admin/members/${member.id}/role`, { method: 'PUT', body: { role: roleSelect.value }, csrfToken });
            save.textContent = 'Guardado';
          } catch (error) {
            membersList.prepend(node('p', 'form-message', error.message));
          }
        });
        actions.append(roleSelect, save);
        const ban = node('button', 'news-action', isActive ? 'Banear' : 'Reactivar');
        ban.type = 'button';
        ban.addEventListener('click', async () => {
          const nextActive = !isActive;
          const action = nextActive ? 'reactivar' : 'banear';
          if (!confirm(`¿Quieres ${action} la cuenta de ${member.displayName}?`)) return;
          try {
            await api(`/api/admin/members/${member.id}/ban`, {
              method: 'PATCH',
              body: { active: nextActive },
              csrfToken,
            });
            await loadMembers();
          } catch (error) {
            membersList.prepend(node('p', 'form-message', error.message));
          }
        });
        const remove = node('button', 'news-action news-action-delete', 'Eliminar');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (!confirm(`¿Eliminar permanentemente la cuenta de ${member.displayName}? Se borrarán sus ideas y sesiones; las reservas históricas se conservarán sin vincular al perfil.`)) return;
          try {
            await api(`/api/admin/members/${member.id}`, { method: 'DELETE', csrfToken });
            await loadMembers();
          } catch (error) {
            membersList.prepend(node('p', 'form-message', error.message));
          }
        });
        actions.append(ban, remove);
        row.append(info, actions);
        membersList.append(row);
      });
    } catch (error) {
      membersList.replaceChildren(node('p', 'list-empty', error.message));
    }
  }

  async function loadIdeas() {
    ideasList.replaceChildren(node('p', 'list-loading', 'Cargando ideas y apelaciones…'));
    try {
      const [ideasData, appealsData] = await Promise.all([
        api('/api/admin/ideas'),
        api('/api/admin/appeals'),
      ]);
      ideasList.replaceChildren(node('h3', 'staff-queue-heading', 'Ideas de la comunidad'));
      if (!ideasData.ideas.length) ideasList.append(node('p', 'list-empty', 'Todavía no hay ideas.'));
      ideasData.ideas.forEach((idea) => {
        const row = node('article', 'admin-news-row');
        const info = node('div', 'admin-news-headline');
        info.append(statusBadge(idea.status), node('h3', '', idea.title));
        info.append(node('p', '', `${idea.author} · ${idea.authorEmail}`), node('p', '', idea.description));
        const actions = node('div', 'admin-news-actions');
        if (idea.status === 'pending') {
          const note = node('input', 'idea-moderation-note');
          note.type = 'text';
          note.maxLength = 500;
          note.placeholder = 'Nota opcional';
          note.setAttribute('aria-label', `Nota para ${idea.title}`);
          actions.append(note);
          [['approved', 'Aprobar'], ['rejected', 'Rechazar']].forEach(([status, label]) => {
            const button = node('button', status === 'approved' ? 'news-action' : 'news-action news-action-delete', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
              try {
                await api(`/api/admin/ideas/${idea.id}`, {
                  method: 'PATCH',
                  body: { status, moderationNote: note.value },
                  csrfToken,
                });
                await loadIdeas();
              } catch (error) {
                ideasList.prepend(node('p', 'form-message', error.message));
              }
            });
            actions.append(button);
          });
        } else if (idea.moderationNote) {
          info.append(node('p', '', `Nota: ${idea.moderationNote}`));
        }
        row.append(info, actions);
        ideasList.append(row);
      });

      ideasList.append(node('h3', 'staff-queue-heading', 'Apelaciones de baneos'));
      if (!appealsData.appeals.length) ideasList.append(node('p', 'list-empty', 'No hay apelaciones.'));
      appealsData.appeals.forEach((appeal) => {
        const row = node('article', 'admin-news-row');
        const info = node('div', 'admin-news-headline');
        info.append(statusBadge(appeal.status === 'pending' ? 'open' : 'closed'), node('h3', '', appeal.memberName));
        info.append(node('p', '', appeal.memberEmail), node('p', '', appeal.reason));
        const actions = node('div', 'admin-news-actions');
        if (appeal.status === 'pending') {
          const response = node('input', 'idea-moderation-note');
          response.type = 'text';
          response.maxLength = 1000;
          response.placeholder = 'Respuesta para la persona';
          response.setAttribute('aria-label', `Respuesta para apelación de ${appeal.memberName}`);
          actions.append(response);
          [['accepted', 'Aceptar apelación'], ['rejected', 'Mantener baneo']].forEach(([status, label]) => {
            const button = node('button', status === 'accepted' ? 'news-action' : 'news-action news-action-delete', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
              try {
                await api(`/api/admin/appeals/${appeal.id}`, {
                  method: 'PATCH',
                  body: { status, staffResponse: response.value },
                  csrfToken,
                });
                await loadIdeas();
              } catch (error) {
                ideasList.prepend(node('p', 'form-message', error.message));
              }
            });
            actions.append(button);
          });
        } else {
          info.append(node('p', '', `Respuesta: ${appeal.staffResponse || 'Sin nota'}`));
        }
        row.append(info, actions);
        ideasList.append(row);
      });
    } catch (error) {
      ideasList.replaceChildren(node('p', 'list-empty', error.message));
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        document.querySelector(`#${item.getAttribute('aria-controls')}`).hidden = !selected;
      });
      if (tab.dataset.adminTab === 'tournaments') loadTournaments();
      if (tab.dataset.adminTab === 'reservations') loadReservations();
      if (tab.dataset.adminTab === 'members') loadMembers();
      if (tab.dataset.adminTab === 'ideas') loadIdeas();
    });
  });
  document.querySelector('#refresh-reservations').addEventListener('click', loadReservations);
  document.querySelector('#refresh-members').addEventListener('click', loadMembers);
  document.querySelector('#refresh-ideas').addEventListener('click', loadIdeas);
}
