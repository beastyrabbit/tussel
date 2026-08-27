setcps(0.75)
stack(s("bd ~ rim sd").mask("1 1 0 1"), s("hh hh hh hh").gain(0.5).late(0.01), n("60 60 63 65").s("saw").slow(2).lpf(700).release(0.3), n("67 65 63 60").s("triangle").gain(0.15).early(0.125))
