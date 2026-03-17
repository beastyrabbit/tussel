setcps(0.5)
stack(s("bd sd hh cp").every(3, x => x.fast(2)), note("0 2 4 7").s("sine").release(0.2).gain(0.3).every(4, x => x.slow(2)))
