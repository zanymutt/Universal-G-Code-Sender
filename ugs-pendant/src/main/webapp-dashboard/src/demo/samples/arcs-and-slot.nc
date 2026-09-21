(UGS Dashboard demo: a circular pocket and a rounded slot, cut in two passes)
(Units = mm)
G21 G90 G17 G54
M3 S12000
G0 Z5
(--- circular pocket, R20 centred on X40 Y30 ---)
G0 X60 Y30
G1 Z-1 F300
G2 X60 Y30 I-20 J0 F900
G1 Z-2 F300
G2 X60 Y30 I-20 J0 F900
G0 Z5
(--- slot from X10 to X70 with rounded ends ---)
G0 X10 Y70
G1 Z-1 F300
G1 X70 F900
G2 X70 Y60 I0 J-5
G1 X10
G2 X10 Y70 I0 J5
G1 Z-2 F300
G1 X70 F900
G2 X70 Y60 I0 J-5
G1 X10
G2 X10 Y70 I0 J5
G0 Z5
M5
G0 X0 Y0
M30
