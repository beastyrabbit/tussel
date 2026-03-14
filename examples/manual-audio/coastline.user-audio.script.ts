// "coastline" manual native conversion for live speaker output
// @by eddyflux
// @source examples/manual-listen/coastline.strudel.js
// @purpose user_audio_test
samples('./examples/assets/basic-kit');
setcps(0.75);

// Keep the original harmonic intent in the source even though dict/voicing/set/mode
// are still structural placeholders in the native engine today.
const chords = chord('<Bbm9 Fm9>/4').dict('ireal');

const drums = stack(
  s('bd').struct('<[x x] [~@3 x] x>'),
  s('~ [rim, sd:<2 3>]').room('<0 .2>'),
  n('[0 <1 3>]*4').s('hh'),
  s('rim:<1!3 2>*2').mask('<0 0 1 1>/16').gain(0.5),
)
  .bank('crate')
  .mask('<[0 1] 1 1 1>/16'.early(0.5));

const chordVoice = note('<[bb3,db4,f4,ab4] [f3,ab3,c4,eb4]>/2')
  .offset(-1)
  .voicing()
  .s('triangle')
  .phaser(4)
  .room(0.5)
  .gain(0.18)
  .slow(2)
  .lpf(sine.range(400, 1200).slow(8));

const bass = note('<bb1!3 f1*2>/2')
  .set(chords)
  .mode('root:g2')
  .voicing()
  .s('saw')
  .attack(0.01)
  .decay(0.08)
  .sustain(0.45)
  .release(0.18)
  .lpf(sine.range(140, 320).slow(6))
  .gain(0.11);

const lead = note('<d5!3 f5*2 eb5 bb4>/2 <c5 eb5 g5 f5>/2')
  .anchor('D5')
  .voicing()
  .segment(4)
  .clip(rand.range(0.4, 0.8))
  .room(0.75)
  .shape(0.3)
  .delay(0.25)
  .fm(sine.range(3, 8).slow(8))
  .lpf(sine.range(500, 1000).slow(8))
  .lpq(5)
  .rarely(ply('2'))
  .chunk(4, fast(2))
  .gain(perlin.range(0.6, 0.9))
  .mask('<0 1 1 0>/16')
  .s('square')
  .pan(sine.range(-0.45, 0.45).slow(6));

stack(drums, chordVoice, bass, lead).late('[0 .01]*4').late('[0 .01]*2').size(4);
