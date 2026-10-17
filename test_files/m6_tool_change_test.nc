( M6 tool change test - AIR ONLY: no spindle, nothing is cut )
( Set work zero with the bit well ABOVE the stock. Every move stays at Z10 )
( and the footprint is 20 mm x 20 mm from the work zero. )
G21 G90 G17
G0 Z10
G0 X0 Y0
(MSG, About to change to tool 1)
T1 M6
G0 Z10
G0 X20 Y0
G1 X20 Y20 F600
G0 Z10
(MSG, About to change to tool 2)
T2 M6
G0 X0 Y20
G1 X0 Y0 F600
G0 Z10
M30
