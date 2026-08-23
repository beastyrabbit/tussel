/** Shared numeric constants for the pattern engine. */

/**
 * Default MIDI velocity / CC value when no explicit velocity, gain, or value
 * is provided in the event payload.
 *
 * 102 (out of 0-127) corresponds to ~80 % intensity — a musically sensible
 * "moderately loud" default that avoids both inaudible softness and harsh
 * maximum volume.
 */
export const DEFAULT_MIDI_VALUE = 102;
