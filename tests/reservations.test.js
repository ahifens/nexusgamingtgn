import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { seedDatabase } from '../server/src/db/seed.js';
import {
  cancelReservation,
  createReservation,
  getAvailability,
  ReservationError,
} from '../server/src/reservations.js';

let database;

function futureDate(offsetDays = 2) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function reservationInput(overrides = {}) {
  return {
    seatType: 'pc-gaming',
    date: futureDate(),
    startTime: '14:00',
    durationHours: 2,
    customerName: 'Alex Jugador',
    customerEmail: 'alex@example.test',
    customerPhone: '+34600111222',
    consent: true,
    website: '',
    ...overrides,
  };
}

beforeEach(() => {
  database = createDatabase(':memory:');
  migrateDatabase(database);
  seedDatabase(database);
});

afterEach(() => database.close());

describe('reservas', () => {
  it('calcula disponibilidad por duración, precio y horario de apertura', () => {
    const result = getAvailability(database, {
      seatType: 'pc-gaming',
      date: futureDate(),
      durationHours: '2',
    });

    expect(result.slots[0]).toMatchObject({ startTime: '12:00', available: true, totalCents: 1000 });
    expect(result.slots.some((slot) => slot.startTime === '22:00')).toBe(false);
  });

  it('evita superar la capacidad dentro de una transacción inmediata', () => {
    database.prepare("UPDATE seat_types SET capacity = 1 WHERE slug = 'pc-gaming'").run();
    const first = createReservation(database, reservationInput());

    expect(first).toMatchObject({ status: 'pending', totalCents: 900 });
    expect(() => createReservation(database, reservationInput({ customerEmail: 'otro@example.test' })))
      .toThrowError(new ReservationError(409, 'Ya no quedan puestos libres en ese tramo. Elige otra hora.'));

    const availability = getAvailability(database, {
      seatType: 'pc-gaming',
      date: futureDate(),
      durationHours: 2,
    });
    expect(availability.slots.find((slot) => slot.startTime === '14:00').available).toBe(false);
    expect(availability.slots.find((slot) => slot.startTime === '16:00').available).toBe(true);
  });

  it('limita reservas activas por contacto y valida los cierres', () => {
    createReservation(database, reservationInput({ startTime: '12:00' }));
    createReservation(database, reservationInput({ startTime: '15:00' }));
    createReservation(database, reservationInput({ startTime: '18:00' }));

    expect(() => createReservation(database, reservationInput({ startTime: '20:00' })))
      .toThrowError(ReservationError);

    database.prepare('INSERT INTO closure_dates (closed_on, reason) VALUES (?, ?)').run(futureDate(3), 'Festivo');
    expect(getAvailability(database, {
      seatType: 'pc-gaming',
      date: futureDate(3),
      durationHours: '1',
    }).slots).toHaveLength(0);
  });

  it('cancela con token y respeta el límite de antelación', () => {
    const reservation = createReservation(database, reservationInput());

    expect(cancelReservation(database, reservation.code, reservation.cancellationToken))
      .toEqual({ code: reservation.code, status: 'cancelled' });
    expect(() => cancelReservation(database, reservation.code, 'token-invalido'))
      .toThrowError(ReservationError);
  });
});
