---
layout: post
title:  "Reversing GDB with GDB"
date:   2020-04-02 21:32:10 -0700
categories: reversing
---



- [TL;DR](#tldr)
- [What you'll get from this post](#what-youll-get-from-this-post)
- [Has this been done?](#has-this-been-done)
- [Wait, do we **really** need to modify GDB source to pull this off?](#modify)
- [What's `readline`?](#)



The goal here is to talk through my adventure of getting the popular 
[fuzzy finder, fzf,](https://github.com/junegunn/fzf) to work with GDB's history, just like it works
with Bash history out of the box.

![example](/assets/imgs/fzfgdb.gif)

GNU GDB is a massive project
```bash
$ fd -e .c | xargs cat | grep -v "^\s*$" | wc -l
2291022
```
with about **2.3 million** lines of C source code. So how do we go about making a change to something so
big?



## What you'll get from this post
- Tips for quickly nailing down where your changes need to go
- Static and dynamic anaylsis tips using tools like `ctags`, `gdb`, `strace`
- A more complete mental model of what happens from the moment I press the key on my keyboard to the
  moment that my running process receives my keypress.



## Topics
- terminals, pseudo terminals
- fzf reads over stdin, write to stdout, controls terminal via fd 3
- looking at bash and how it handles fzf
- looking at fzf bash source code to see what it's doing
- compiling Gdb with debug symbols (turn off optimization)
- how does readline work
    - reads char by char
    - writes back to terminal
    - fzf can't simply write into the terminal because readline wouldn't see it
- reversing readline?



## Haven't decided where to put these points yet
- reverse engineering is a creative process
- there's no tool out there that can just automatically tell you everything you need to know
- know the tools, and combine them creatively to break down the problem as fast you can
- one of the goals is simply to do it quickly. If you use a tool and you're fed up with some aspect
  of it and you want to modify it, you don't want to spend the next week trying to figure out how it
  works. You want it done in a weekend or less.
- given enough time anyone can reverse engineer anything, we want to do it quickly. That's where the
  creativity comes in.
- often we get trapped thinking that there's some special tool out there that we need to learn in
  order to solve some task at hand. Yes there are lots of tools out there that are extremely useful,
  but once you've got the basic tools figured out, you need to get out of the mindset of expecting
  tools to solve all your issues. Start using the tools in creative ways.



## Has this been done? (maybe change this)
## TODO Section title

We know this works with Bash, so why can't we trivially do this with GDB?

- how does fzf implement history search in Bash
- fzf inserts this little line at the end of your `.bashrc`
```bash
[ -f ~/.fzf.bash ] && source ~/.fzf.bash
```
- so lets see what it does
- at the end of `.fzf.bash` we have 
```bash
source "$HOME/fzf/shell/key-bindings.bash"
```
- at the end of `key-bindings.bash` we have
```bash
bind -m emacs-standard -x '"\C-r": __fzf_history__'
```
- checkout `man bash` for details on what `bind -x` does.
- in `man bash` you'll notice a section titled **Readline Key Bindings**, 
  [check this out](#whats-readline) if you don't know what Readline does.
- `Ctrl-r` will call `__fzf_history__` and paste the output into the current Readline line buffer
- can we do something like this in GDB?
- googling `GDB keybindings` will quickly [show you](https://stackoverflow.com/a/35801000/6824752)
  that GDB also uses the Readline library
- unfortunately I've found that GDB's only mechanism for customizing keybindings is via `~/.inputrc`
  file, which isn't nearly as flexible as Bash's `bind` builtin command. See 
  [this](https://ftp.gnu.org/old-gnu/Manuals/gdb/html_node/gdb_246.html) for an example inputrc
  file. 


![this issue](/assets/imgs/githubissue.png)

`bash` and `gdb` both compile `readline` into their binaries, but the key difference is in how
`bash` and `gdb` expose their internal `readline` keymap to the user.

`bash` has a nice builtin function called `bind`. If you take a look at `fzf`'s keybindings file `fzf/shell/key-bindings.bash`

and `-x` makes it such that the function is immediately executed when the key sequence is pressed
and the **output is copied into the current line buffer**.

`gdb` doesn't provide such an interface. Instead, it uses the standard `~/.inputrc` file.

```bash
$ man readline
...
INITIALIZATION FILE
       Readline is customized by putting commands in an initialization file (the  inputrc  file).
...
```
`~/.inputrc` isn't expressive enough for us. It doesn't allow us to execute commands and copy the
output into the readline buffer.



## Conceptualizing terminal programs

Having a decent understanding of how programs receive input from the keyboard is useful for
understanding all this.

```
                         __________________         ___________            
    ____________        |                  |       |           |            
   |            |       |                  |<------| Process   |                   
   |  Keyboard  |------>|                  |------>|   e.g.    |                  
   |____________|       |    Terminal      |       | /bin/bash |            
                        |                  |       |___________|
                        |                  |                               
                        |__________________|                                     

```

- used to use [terminals](https://en.wikipedia.org/wiki/Computer_terminal).
- similar now except we emulate the terminal hardware
- implements the file interface
- interactions with terminal device happen through read,write,ioctl,etc (just like any other device
  or file on linux)
- this is a simplified picture, but conceptualizing it this way is just enough for 99% of what we do
- I hit button on keyboard, character gets sent to terminal device, terminal interprets that
  character, then either sends it to the connected process or interprets it as a command for
  something to do. E.g., kill connected process
- the terminal settings can be changed via `stty` command (see `man stty`). For example, you can
  disable `Ctrl-d` and `Ctrl-c` so that it doesn't kill the connected process. There are many
  options. Terminals truely are complicated devices that largely go unnoticed.

```bash
$ lsof -p 5606
...
bash    5606   fk    0u   CHR  136,3      0t0        6 /dev/pts/3
bash    5606   fk    1u   CHR  136,3      0t0        6 /dev/pts/3
bash    5606   fk    2u   CHR  136,3      0t0        6 /dev/pts/3
```



## What happens when you press `Ctrl-r`
We're ultimately interested in replacing the default `Ctrl-r` behaviour
```bash
gdb> 
(reverse-i-search)`':
```
with our own custom command. 

So what writes that `(reverse-i-search)` string to our terminal?



## REMINDER FOR MYSELF
The order in which I did things while reversing
- I poked around gdb source looking at readline specifically
- I messed around with callgrind
- I found that `_rl_dispatch` was responsible for choosing the function to exec from the keymap
- once I had that I decided I'd just copy what bash was doing
- NOTE the reason I was looking at bash in the first place, was actually just to see how they
  implemented the function that runs your custom command
- so set a break at `_rl_dispatch` and started debugging bash
- then I basically copied bash's implementation to gdb


## What's Readline?
- what is readline
- [readline](https://en.wikipedia.org/wiki/GNU_Readline)
- basically it's some code that's typically compiled into interactive command line apps. It provides
  line editing capabilities, tab completion, etc. 
- an example of line editing would be holding backspace to delete what you've typed so far at your
  Bash prompt. Or simpler, using the `Ctrl-u` keybinding to delete everything behind the cursor.
  Readline handles all that.
- first terminal line editing is disabled (with ioctl)
- Bash hands off control over the terminal to readline
- readline handles reading the command
- when new line is entered, readline hands the typed command over to Bash, which then executes it
- when Bash is ready for a new command, it echos a new prompt and hands control over to Readline
  again.

## TODO section title

- we know that gdb uses readline
- first grab gdb
- so lets just take a look at the code

```bash
$ ls -l readline/readline | grep keymap
-rw-rw-r-- 1 fk fk  37639 Apr  1 08:40 emacs_keymap.c
-rw-rw-r-- 1 fk fk   4072 Nov 19 01:10 keymaps.c
-rw-rw-r-- 1 fk fk   3260 Nov 19 01:10 keymaps.h
-rw-rw-r-- 1 fk fk  36529 Nov 19 01:10 vi_keymap.c
```

- a few files referring to keymap. This must be where readline maps keys to particular functions
- I use the emacs keymap, so lets poke around `emacs_keymap.c`
- everything is nicely commented so just search for `Control-r`

```c
  { ISFUNC, rl_fzf_search_history },	/* Control-r */
```

- and bam there's the default `Ctrl-r` function
- so lets replace that with our own function that just prints "hello world!" and recompile
- TODO section on compiling
- show gif of "hello world"

- this isn't as simple as just calling `fzf` in our function.
- there are a couple of things that we need to do in addition.
  1. write the history (stored in GDB's memory) into `fzf`'s stdin
  2. read the result from `fzf` and place it into the current line buffer (TODO link to section
     about line buffer)

- we want to be FASTTT, so lets minimize our work and just see how Bash does this
- we know that Bash's `bind -x` allows us to bind custom shell commands to a key and write the
  output from the command into the current line buffer
- this is exactly what we want to do so lets just see what the Bash authors did

Grab the latest from [GNU bash downloads](https://ftp.gnu.org/gnu/bash/)

- run gdb under debugger, set breakpoint at `rl_fzf_search_history`, trigger it, the `bt`, bt will
  tell us the sequence of ancestor function calls. There we'll see `_rl_dispath`.
- so set a breakpoint at `_rl_dispath` while debugging Bash.
- trigger `fzf` search history in Bash with `Ctrl-r`
- then step throuugh `_rl_dispath` until you get to the corresponding function that implements
  running a custom command (TODO get the name of that func, etc.)
- and there it is, we'll copy pasta this into GDB's `readline.c` and modify it to our liking.



<a name="modify"></a>
## Wait, do we need to modify GDB source to pull this off?

Poking around `fzf/shell/key-bindings.bash`, we see that prior to `bash 4.0`, `fzf` used a super
ugly command that didn't need `-x`.

```bash
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  # CTRL-R - Paste the selected command from history into the command line
  bind -m emacs-standard '"\C-r": "\C-e \C-u\C-y\ey\C-u"$(__fzf_history__)"\e\C-e\er"'
else
  # CTRL-R - Paste the selected command from history into the command line
  bind -m emacs-standard -x '"\C-r": __fzf_history__'
fi
```

Here's a breakdown

```
bind -m emacs-standard \
  '"\C-r": "\C-e \C-u\C-y\ey\C-u"$(__fzf_history__)"\e\C-e\er"'
              ^    ^   ^  ^   ^         ^            ^  ^  ^
              |    |   |  |   |         |            |  |  |
              |    |   |  |   |         |            |  |  ESC followed by r
              |    |   |  |   |         |            |  move cursor end of line
              |    |   |  |   |         |            ESC
              |    |   |  |   |         Start subshell
              |    |   |  |   kill text
              |    |   |  ESC followed by y (no idea whats going on)
              |    |   yank saved text back onto terminal
              |    kill backwards (save killed text for later)
              move to end of line
```

So can we do something like this in `gdb` using the `shell` command?

**MAYBE, probably? Can't you do anything in Linux?**, I don't know, that command is already
extremely confusing and I admit I don't fully understand what some of the escape sequences like
`\ey` `\e\C-e` are doing.

It would be tricky
- you would need to pull the current **in memory** history out of gdb, then pipe that into `fzf`
  along with the history file contents.
- you would also need to get that ugly command up there working



## TODO
- links
  - inputrc
  - shell cmd
  - command cmd
- take smaller pics of the github issue to reduce cognitive overhead



## TLDR
- We know that fzf works with bash no problem. This is because of the bash builtin `bind` and the
  `-x` option
- So we'll look through the `bash` source code and see how they implement it.
- Copy pasta code from `bash` into `gdb`
- Compile a custom `gdb`
- A starting GIF does a better showcase of how actually useful it is to have fzf
