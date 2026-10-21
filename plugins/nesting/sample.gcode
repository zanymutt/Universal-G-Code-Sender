(Sample plasma part for the Nesting plugin: 40 x 30 mm triangle with a lead-in)
(Structure mirrors a typical GRBL plasma post: setup, torch height probe, pierce, cut, retract, end)
G90 G94 G17
G21
G54

G0 X10 Y-6 F2500
G0 X10 Y-6 Z25

G53 G38.2 Z0 F200
(Read float switch input immediately after probe stop)
M66 P0 L0
#100 = -3 ; default assume float switch trigger
o100 if [#5399 EQ 0]
  #100 = -0.2 ; float inactive, assume ohmic trigger
o100 endif
G10 L20 Z[#100]
G0 X10 Y-6  ; force position after probe
Z3
M4 S1000
G4 P0.4
G1 Z2.5 F2500
M8
G1 X10 Y0
X40 Y0
X20 Y30
X0 Y0
X10 Y0
X10 Y-6
M5
G4 p0.5
M9
G0 Z30
G0 Z40

M5
G0 X0 Y0
M30
