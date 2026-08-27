setcps(0.5)
stack(s("bd sd hh cp").every(3, x => x.fast(2)), note("60 62 64 67").s("sine").release(0.2).gain(0.3).every(4, x => x.slow(2)))
