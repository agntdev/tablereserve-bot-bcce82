# Telegram TableReserve Bot — Bot specification

**Archetype:** booking

**Voice:** friendly and clear — write every user-facing message, button label, error, and empty state in this voice.

A restaurant reservation bot that prevents double-bookings by showing only genuine available slots. Guests book/reschedule/cancel via buttons, receive reference codes, and get reminders. Owners get real-time booking dashboards with capacity metrics and no-show tracking.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Restaurant guests preferring quick Telegram bookings
- Restaurant owners/staff needing lightweight booking management

## Success criteria

- Zero double-bookings through real-time slot validation
- 100% guest confirmation rate with reference codes
- Real-time owner notifications for all booking changes
- Daily capacity snapshots for owners

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with booking options
- **Book a table** (button, actor: user, callback: booking:start) — Initiate guided booking flow with calendar and time selection
- **View my booking** (button, actor: user, callback: booking:view) — Show current booking with reschedule/cancel options
- **/bookings** (command, actor: owner, command: /bookings) — Show owner dashboard with upcoming bookings and capacity metrics
- **/settings** (command, actor: owner, command: /settings) — Configure opening hours, table inventory, and reminder timing

## Flows

### Guest booking flow
_Trigger:_ /start

1. Select date (next 30 days)
2. Choose available time slot
3. Enter party size
4. Optional name/phone input
5. Confirm booking with reference code
6. Receive reschedule/cancel buttons

_Data touched:_ Booking, Table inventory

### Owner dashboard
_Trigger:_ /bookings

1. Show today's remaining capacity
2. List upcoming bookings with edit options
3. Mark no-shows
4. View full settings

_Data touched:_ Booking, Capacity snapshot

### Reminder system
_Trigger:_ Scheduled task

1. Check bookings N hours before time
2. Send reminder to guest
3. Notify owner of reminder sent

_Data touched:_ Booking

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Table inventory** _(retention: persistent)_ — Configured table types with seats per table
  - fields: table_type, seats, count
- **Booking** _(retention: persistent)_ — Guest reservation with status tracking
  - fields: guest_name, phone, party_size, datetime, table_allocation, status, reference_code
- **Capacity snapshot** _(retention: persistent)_ — Calculated remaining seats/tables per time slot
  - fields: date, time_slot, remaining_seats, remaining_tables
- **Settings** _(retention: persistent)_ — Owner-configured parameters
  - fields: opening_hours, sitting_duration, reminder_offset

## Integrations

- **Telegram** (required) — Bot API messaging for guest/owner interactions
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure opening hours via /settings
- Mark no-shows from booking list
- View capacity metrics at any time

## Notifications

- Guest receives confirmation with reference code
- Owner notified of all booking changes (new/cancelled/no-show)
- Guest gets reminder N hours before booking

## Permissions & privacy

- Guest data stored privately (name/phone optional)
- Reference codes never expose full booking details
- Owner can only view their own restaurant's data

## Edge cases

- Guest tries to book during closed hours
- Reschedule request creates conflicting slots
- Owner marks no-show after booking time has passed
- Multiple simultaneous booking attempts for same slot

## Required tests

- End-to-end booking flow with slot validation
- Owner dashboard shows accurate capacity metrics
- No-show marking updates capacity snapshots
- Reminder system respects configured offset

## Assumptions

- Default 30-day booking window covers typical restaurant needs
- 15-minute slot granularity balances flexibility and simplicity
- Reference codes are 6-character alphanumeric for memorability
