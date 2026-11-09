/** The shared resort clock (seconds). Solo it follows this computer's clock; in a room it follows the
 * server's, so friends see lesson groups, crews and conditions at the same moment of the day. */
export const resortClock = {
  offset: 0,
  now() { return Date.now() / 1000 + this.offset; },
};
