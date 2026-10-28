import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const madridFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const reservationSchema = z.object({
  seatType: z.string().min(1).max(80),
  date: z.string().regex(datePattern),
  startTime: z.string().regex(timePattern),
  durationHours: z.coerce.number().int().min(1).max(6),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  customerPhone: z.string().trim().regex(/^\+?[0-9\s().-]{7,24}$/),
  consent: z.literal(true),
  website: z.string().max(0).optional(),
  memberId: z.coerce.number().int().positive().optional(),
});

const availabilitySchema = z.object({
  seatType: z.string().min(1).max(80),
  date: z.string().regex(datePattern),
  durationHours: z.coerce.number().int().min(1).max(6),
});

export class ReservationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function madridParts(date = new Date()) {
  return Object.fromEntries(madridFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

function dateInMadrid() {
  const parts = madridParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutes(time) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function isRealDate(value) {
  return datePattern.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validateDateAndTime(date, startTime) {
  if (!isRealDate(date)) throw new ReservationError(400, 'Indica una fecha válida.');
  const today = dateInMadrid();
  if (date < today) throw new ReservationError(400, 'No se pueden reservar fechas pasadas.');

  if (date === today) {
    const parts = madridParts();
    const currentTime = Number(parts.hour) * 60 + Number(parts.minute);
    if (minutes(startTime) <= currentTime) {
      throw new ReservationError(400, 'La hora elegida ya ha pasado.');
    }
  }
}

function seatDetails(database, slug) {
  const seat = database.prepare(`
    SELECT id, slug, name, capacity
    FROM seat_types
    WHERE slug = ? AND active = 1
  `).get(slug);

  if (!seat) throw new ReservationError(404, 'Ese tipo de puesto no está disponible.');
  return seat;
}

function openingDetails(database, date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hours = database.prepare(`
    SELECT opens_at AS opensAt, closes_at AS closesAt, is_closed AS isClosed
    FROM opening_hours
    WHERE weekday = ?
  `).get(weekday);
  const closure = database.prepare('SELECT reason FROM closure_dates WHERE closed_on = ?').get(date);

  if (!hours || hours.isClosed || closure) return null;
  return hours;
}

function priceForSlot(database, seatId, startMinute, durationHours) {
  const hourlyRate = database.prepare(`
    SELECT price_cents AS priceCents
    FROM pricing_rules
    WHERE seat_type_id = ? AND kind = 'hourly' AND active = 1
    ORDER BY id
    LIMIT 1
  `).get(seatId);

  if (!hourlyRate) throw new ReservationError(409, 'Este puesto todavía no tiene una tarifa configurada.');

  const discountRules = database.prepare(`
    SELECT starts_at AS startsAt, ends_at AS endsAt, price_cents AS discountPercent
    FROM pricing_rules
    WHERE kind = 'time_discount' AND active = 1
  `).all();
  let hourlyTotal = 0;

  for (let hour = 0; hour < durationHours; hour += 1) {
    const slotMinute = startMinute + hour * 60;
    const discount = discountRules.find((rule) => {
      const startsAt = minutes(rule.startsAt);
      const endsAt = minutes(rule.endsAt);
      return slotMinute >= startsAt && slotMinute < endsAt;
    });
    const multiplier = discount ? (100 - discount.discountPercent) / 100 : 1;
    hourlyTotal += Math.round(hourlyRate.priceCents * multiplier);
  }

  const pack = database.prepare(`
    SELECT price_cents AS priceCents
    FROM pricing_rules
    WHERE kind = 'pack' AND active = 1 AND duration_hours = ?
      AND (seat_type_id IS NULL OR seat_type_id = ?)
    ORDER BY price_cents
    LIMIT 1
  `).get(durationHours, seatId);

  return pack ? Math.min(hourlyTotal, pack.priceCents) : hourlyTotal;
}

function activeOverlaps(database, seatId, date, startMinute, durationHours) {
  const rows = database.prepare(`
    SELECT start_time AS startTime, duration_hours AS durationHours
    FROM reservations
    WHERE seat_type_id = ? AND reservation_date = ?
      AND status IN ('pending', 'confirmed')
  `).all(seatId, date);
  const requestedEnd = startMinute + durationHours * 60;

  return rows.filter((reservation) => {
    const existingStart = minutes(reservation.startTime);
    const existingEnd = existingStart + reservation.durationHours * 60;
    return existingStart < requestedEnd && existingEnd > startMinute;
  }).length;
}

export function getAvailability(database, rawQuery) {
  const parsed = availabilitySchema.safeParse(rawQuery);
  if (!parsed.success) throw new ReservationError(400, 'Revisa el puesto, la fecha y la duración.');

  const { seatType: slug, date, durationHours } = parsed.data;
  validateDateAndTime(date, '23:59');
  const seat = seatDetails(database, slug);
  const opening = openingDetails(database, date);

  if (!opening) return { date, seatType: slug, durationHours, slots: [], message: 'El local está cerrado ese día.' };

  const openingMinute = minutes(opening.opensAt);
  const closingMinute = minutes(opening.closesAt);
  const slots = [];

  for (let startMinute = openingMinute; startMinute + durationHours * 60 <= closingMinute; startMinute += 60) {
    const hour = String(Math.floor(startMinute / 60)).padStart(2, '0');
    const minute = String(startMinute % 60).padStart(2, '0');
    const startTime = `${hour}:${minute}`;
    const remaining = Math.max(0, seat.capacity - activeOverlaps(database, seat.id, date, startMinute, durationHours));

    if (date === dateInMadrid()) {
      const parts = madridParts();
      const currentTime = Number(parts.hour) * 60 + Number(parts.minute);
      if (startMinute <= currentTime) continue;
    }

    slots.push({
      startTime,
      available: remaining > 0,
      remaining,
      totalCents: priceForSlot(database, seat.id, startMinute, durationHours),
    });
  }

  return { date, seatType: slug, durationHours, capacity: seat.capacity, slots };
}

function cancellationTokenMatches(expected, actual) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function madridWallTimeToDate(date, time) {
  const approximate = new Date(`${date}T${time}:00Z`);
  const parts = madridParts(approximate);
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  const offset = representedAsUtc - approximate.getTime();
  return new Date(approximate.getTime() - offset);
}

export function createReservation(database, rawInput) {
  const parsed = reservationSchema.safeParse(rawInput);
  if (!parsed.success) throw new ReservationError(400, 'Revisa los datos y acepta la política de privacidad.');
  const input = parsed.data;
  if (input.website) throw new ReservationError(400, 'No se ha podido tramitar la reserva.');
  validateDateAndTime(input.date, input.startTime);

  const create = database.transaction(() => {
    const seat = seatDetails(database, input.seatType);
    if (input.memberId) {
      const member = database.prepare('SELECT email FROM members WHERE id = ? AND active = 1').get(input.memberId);
      if (!member || member.email.toLowerCase() !== input.customerEmail) {
        throw new ReservationError(403, 'Inicia sesión con el email usado para esta reserva.');
      }
    }
    const opening = openingDetails(database, input.date);

    if (!opening) throw new ReservationError(409, 'El local está cerrado en la fecha elegida.');

    const startMinute = minutes(input.startTime);
    const openingMinute = minutes(opening.opensAt);
    const closingMinute = minutes(opening.closesAt);
    const endMinute = startMinute + input.durationHours * 60;
    if (startMinute < openingMinute || endMinute > closingMinute || (startMinute - openingMinute) % 60 !== 0) {
      throw new ReservationError(409, 'La hora elegida está fuera del horario de apertura.');
    }

    const overlaps = activeOverlaps(database, seat.id, input.date, startMinute, input.durationHours);
    if (overlaps >= seat.capacity) throw new ReservationError(409, 'Ya no quedan puestos libres en ese tramo. Elige otra hora.');

    const activeContactReservations = database.prepare(`
      SELECT COUNT(*) AS count
      FROM reservations
      WHERE status IN ('pending', 'confirmed')
        AND (lower(customer_email) = ? OR customer_phone = ?)
    `).get(input.customerEmail, input.customerPhone).count;
    if (activeContactReservations >= 3) {
      throw new ReservationError(429, 'Este contacto ya tiene el máximo de reservas activas.');
    }

    const code = `LG-${randomBytes(5).toString('hex').toUpperCase()}`;
    const cancellationToken = randomBytes(24).toString('base64url');
    const totalCents = priceForSlot(database, seat.id, startMinute, input.durationHours);
    database.prepare(`
      INSERT INTO reservations
        (member_id, code, cancellation_token, seat_type_id, reservation_date, start_time, duration_hours,
         customer_name, customer_email, customer_phone, total_cents, status, consent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `).run(
      input.memberId ?? null,
      code,
      cancellationToken,
      seat.id,
      input.date,
      input.startTime,
      input.durationHours,
      input.customerName,
      input.customerEmail,
      input.customerPhone,
      totalCents,
    );

    return {
      code,
      cancellationToken,
      seatType: seat.name,
      date: input.date,
      startTime: input.startTime,
      durationHours: input.durationHours,
      totalCents,
      status: 'pending',
    };
  });

  const reservation = create.immediate();
  console.info(`[correo simulado] confirmación preparada para ${reservation.code}`);
  return reservation;
}

export function cancelReservation(database, code, token) {
  if (typeof code !== 'string' || typeof token !== 'string' || token.length < 20) {
    throw new ReservationError(400, 'El enlace de cancelación no es válido.');
  }

  const cancel = database.transaction(() => {
    const reservation = database.prepare(`
      SELECT id, cancellation_token AS cancellationToken, reservation_date AS date,
        start_time AS startTime, status
      FROM reservations WHERE code = ?
    `).get(code);

    if (!reservation || !cancellationTokenMatches(reservation.cancellationToken, token)) {
      throw new ReservationError(404, 'No encontramos una reserva con ese código y enlace.');
    }
    if (!['pending', 'confirmed'].includes(reservation.status)) {
      throw new ReservationError(409, 'Esta reserva ya no se puede cancelar.');
    }

    const startsAt = madridWallTimeToDate(reservation.date, reservation.startTime);
    if (startsAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      throw new ReservationError(409, 'La cancelación debe solicitarse con al menos 24 horas de antelación.');
    }

    database.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(reservation.id);
    return { code, status: 'cancelled' };
  });

  return cancel.immediate();
}
