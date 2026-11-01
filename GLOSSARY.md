# TV Parental Control

A phone-controlled time limit for the children's use of the family TV (today LG webOS; more brands can be added as TV drivers).

This is the project's shared language. Use these words in code, tests, docs and issues. The user interface shows them in nine languages; the Norwegian term (the project's original language) is given for each, so that `locales/no.json` stays recognisable.

## Language

**Child mode** (Norwegian: *Barnemodus*):
The state in which TV time counts against today's Quota. Parents turn it on manually, or automatically at a time they choose on the settings page. It applies to the whole TV until a Parent turns it off or a new Quota day begins, when it is turned off automatically if that is chosen on the settings page. Both automatic turn-on and automatic turn-off are configurable.
_Avoid_: Child lock, restricted mode, parental control

**Parent** (*Forelder*):
An adult in the household who may turn Child mode on and off, give Extra time and open the Lock. There are two Parents, and both have the same rights.
_Avoid_: Admin, user, owner

**TV time** (*TV-tid*):
The time the TV is switched on while Child mode is on, regardless of app or input. Time while Child mode is off does not count.
_Avoid_: Screen time, usage time

**Quota day** (*Kvotedøgn*):
The day within which TV time is counted. It starts at a time Parents choose on the settings page (default 05:00) and ends at the same time the next day. The Quota resets then.
_Avoid_: Day, 24 hours

**Quota** (*Kvote*):
The number of minutes of TV time the children have in one Quota day. There is one shared Quota for the TV, with a separate value for weekdays and weekends.
_Avoid_: Limit, budget, time limit

**Extra time** (*Ekstra tid*):
Minutes a Parent adds to today's Quota. It only applies to the current Quota day.
_Avoid_: Bonus, postponement

**Remove time** (*Trekk av tid*; `reduceTime` in code):
Minutes a Parent takes away from today's Quota. Never more than what is left is removed, and when the remainder reaches 0 the Lock engages, so the TV shows "time is up" and is turned off. Only applies to the current Quota day.
_Avoid_: Punishment, cut

**TV driver** (*TV-driver*):
The code that connects the app to one TV brand. It knows how to reach the TV, whether it is on, and how to show it a message and turn it off. Everything else in the app is the same for every brand.
_Avoid_: Plugin, adapter, integration

**The Lock** (*Låsen*):
The state that occurs when the Quota is used up while Child mode is on. The TV is turned off as soon as it is on, until a Parent gives Extra time or turns Child mode off, or until the next Quota day begins.
_Avoid_: Block, blocking, shutdown
