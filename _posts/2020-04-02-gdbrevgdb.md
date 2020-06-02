---
layout: post
title:  "Adding fuzzy history search to GDB"
date:   2020-04-02 21:32:10 -0700
permalink: posts/gdb-fuzzy-history
toc: true
toc_sticky: true
categories: reversing implementation
---

![example](/assets/imgs/fzfgdb2.gif)


[fzf-github]: https://github.com/junegunn/fzf
[fzf-gdb-issue]: https://github.com/junegunn/fzf/issues/1516
[gdb-patch]: https://github.com/filipkilibarda/gdb_fzf_patch
[gdb-keybindings-docs]: https://ftp.gnu.org/old-gnu/Manuals/gdb/html_node/gdb_246.html


<br/>

# [Get the patch and installation instructions here][gdb-patch] 
{: .no_toc}

<br/>





Intro
====================================================================================================

In this post I'll walk through the thought process that I took to reverse engineer the command
prompt portion of GDBs code base and implement a small but useful modification.

This is primarily targeted at those who might roughly fall into these categories
- beginner reverse engineer or open source dev
- intimidated by massive code bases
- takes too long to understand the code base, so implementing custom changes isn't worth the immense
  amount of time

I was definitely in all of these categories throughout my entire undergrad and after as well.  After
playing in CTFs for a year, I learned a great deal about how everything on my computer works,
significantly aleviating some of the pains listed above.

So in this post, I hope to shed some light on my reverse engineering and implementation thought
process, specifically some tips and tricks for static and dynamic analysis that can make you much
faster.






<div class="notice" markdown="1">
### A quick note on Bash history and Fzf

Pairing infinite history with Fzf and Bash drastically increased the speed of my workflow, allowing
my thoughts to flow with much shorter interruptions while recalling old commands.

**My bash history acts as a catalog of old commands** and FZF helps me explore that catalog
extremely quickly.

All it takes is for me to remember just a word or two of an old command, and in a matter of seconds,
I've got some long `docker` command from last year ready to go.

As a CTF player, the speed gains here make a huge difference.
</div>


<div class="notice" markdown="1">
### GDB history and Fzf??

With such significant speed gains at the Bash prompt, I **really** wanted to have this at my GDB
prompt as well.

But unfortunately, Fzf doesn't support GDB history search out of the box. After reading [a post from
the author of Fzf][fzf-gdb-issue] where they express complete uncertainty about whether it would be
possible, I gave up on the idea entirely.

Eventually, the thought crossed my mind that I could just modify GDB itself, rather than trying to
jig it together with whatever interfaces GDB exposes already, and as it turns out, it's actually not
too difficult at all.
</div>




<div class="notice--warning" markdown="1">
#### Don't optimize prematurely. Just say what you want to say. Then cut it down later.
</div>



Getting Started
====================================================================================================
A natural place to start was to take a look at how FZF implemented history search in Bash, then try
to replicate that in some way.

I ran the install script for FZF to get a sense for what it did, and found that it added a line to
my `~/.bashrc` that sourced `~/.fzf.bash`.

I followed the reference to `~/.fzf.bash` and found that it sourced keybindings from
`fzf/shell/key-bindings.bash`. This was where I expected to find out how it set up <kbd>Ctrl-r</kbd>
history search. Sure enough at the bottom I found this line:

```bash
bind -m emacs-standard -x '"\C-r": __fzf_history__'
```

The call to bind was straight forward. Whenever <kbd>Ctrl-r</kbd> was pressed, Bash would call
`__fzf_history__`, which presumably just dumped the history and piped it into FZF.

Digging through `man bash` and searching for "bind" gave me the full documentation on how the `bind`
builtin worked.

> Bash allows the current readline key bindings to be displayed or modified with the **bind**
> builtin command.
> <footer>man bash</footer>

The key takeaway here was that `bind` modified **readline** keybindings.

<div class="notice" markdown="1">
**What's Readline?**

Readline is one of the most popular text editors that no one knows about :)

Readline is a piece of software that's compiled into many command line programs, including GDB and
Bash, that provides line editing capabilties and history. In essense, Readline is what's responsible
for reading commands from users, then it hands control off to whatever program is using it, e.g.,
Bash.
</div>

Because <kbd>Ctrl-r</kbd> history search in GDB worked just like <kbd>Ctrl-r</kbd> history search in
Bash, it was clear that they both used Readline.

At this point I was wondering if GDB had it's own `bind`-like mechanism and if I could just use
that. But from my previous research, it was quite clear that it wasn't going to be **that** easy.

As it turned out, `bind` was a builtin command specific to Bash, and..... GDB didn't have it's own
version of it.

Well, actually it did --- in a way.

I googled around for "GDB keybindings", which lead me to [this page][gdb-keybindings-docs]. The GDB
method used the standard Readline configuration file `~/.inputrc`, which mapped key sequences to
either 

  1. other key sequences, or 
  2. Readline commands (`man readline`)

I needed a keybinding that executed a custom script or command and pasted the result into the
current command prompt, and neither of those two options were able do that.

I wanted to completely understand why the `~/.inputrc` method was incapable, so I took a deep dive
and gave a short explanation [here](modify).

So my only option was to modify the Readline source code in GDB. Which I was actually quite thankful
for because hacking together some super ugly thing with `~/.inputrc` wouldn't have been nearly as
fun.




Static analysis --- GDB
====================================================================================================

[Time to grab GDB source code](#downloading-and-compiling-gdb) and start poking around!

We know that GDB uses Readline so lets try to figure out where the code for that is.

After downloading and extracting, listing the files in the root directory shows us a directory
titled `readline`. 

File count is pretty low so manually poking around is easy. 

We can also take a guess and search for the string **history** and **search** using `grep` or `ag`
in the hopes of finding some function or comment regarding history search.

```bash
# This matches lines that have both "history" AND "search" in them
$ ag "history.*search|search.*history" readline/
```

![ag search](/assets/imgs/screenshots/ag_search_history.png)

Conveniently hinting that <kbd>Ctrl-r</kbd> maps to the function `rl_reverse_search_history`.

**Aside**: Readline can be configured with **vi** or **emacs** like keybindings for line editing. If
you're a vim user, you might like vi mode. The default is emacs though (e.g., <kbd>Ctrl-w</kbd> =
delete word, <kbd>Ctrl-u</kbd> = delete everything behind cursor).
{: .notice}

Lets replace `rl_reverse_search_history`with our own function test function and see what happens.

```diff
readline/readline/emacs_keymap.c
-  { ISFUNC, rl_reverse_search_history },       /* Control-r */
+  { ISFUNC, my_test },                         /* Control-r */

readline/readline/isearch.c
+int my_test(int sign, int key) {
+  printf("Hello world!");
+  return 0;
+}

readline/readline/readline.h
+extern int my_test PARAMS((int, int));
```

After [compiling](#downloading-and-compiling-gdb), the binary should be at `bin/gdb` relative to the
build directory.

![Hello world!](/assets/imgs/gdb_helloworld.gif)

Pressing <kbd>Ctrl-r</kbd> a few times, prints `Hello world!` to the terminal!

However, when I hit <kbd>Enter</kbd>, GDB just prints a newline. **Not quite what we wanted**.

We want GDB to try and execute the string `Hello world!` when we press <kbd>Enter</kbd>, instead
it's ignoring it.

If we consider what's happening here, our test function simply writes the text to the terminal. All
that happens is the text gets displayed, and GDB isn't aware of what's displayed on the terminal.

In order to fully comprehend this, we need to consider how GDB receives input from the user.

Here's what happens when I press a key:
1. Key is written to the **terminal device**
2. Terminal device silently sends the character off to the controlling program (GDB) (see `man
   stty`)
3. Readline receives the character
4. Readline stores it in an internal buffer corresponding to the current prompt
5. Readline **writes the character back to the terminal** --- this time the terminal displays the
   character
6. If the character is a newline, Readline hands control over to GDB to execute the command that was
   typed into the prompt

**Terminal device**: terminal devices emulate old school physical terminals that people used to use
many years ago.
{: .notice}

So we need our string to end up in the internal buffer for the current prompt and that'll be our
next few steps in this investigation.

A natural place to start is `rl_reverse_search_history`.

<div class="notice" markdown="1">
#### Finding function definitions

A quick way to find function definitions in C/C++ projects is to use `cscope` 

```bash
$ sudo apt install cscope
# Recursively index all files under the current directory
$ cscope -R
```

or `ctags` if you're a vim user with <kbd>Ctrl-]</kbd> = jump to definition <kbd>Ctrl-t</kbd> = jump
back.
</div>

The function definition shows that it calls `rl_search_history`.

```c
static int rl_search_history (int direction, int invoking_key) {
  _rl_search_cxt *cxt;

  cxt = _rl_isearch_init (direction);
  rl_display_search (cxt->search_string, cxt->sflags, -1);

  r = -1;
  for (;;) {
    c = _rl_search_getchar (cxt);
    r = _rl_isearch_dispatch (cxt, cxt->lastc);
    if (r <= 0)
      break;
  }

  return (_rl_isearch_cleanup (cxt, r));
}
```

The key take aways are:
   - initialize the search (presumably this is where the history list is set up?)
   - display the search string `(reverse-i-search)': ...`
   - loop
      - read char
      - do some action based on which character was typed i.e., either 
        - update the search string and display the updated search result
        - end the search and paste the result into the prompt

Looking at `_rl_isearch_init`

![\_rl_isearch_init](/assets/imgs/screenshots/rl_isearch_init.png)

A history list is something we're going to need, so just save that for later. Conveniently, this
includes the history entries from both the current session and the file based history from all
previous sessions in `.gdb_history`.

- We still haven't answered the question of how to get our `Hello world!` string into the current
  prompt though
- unfortunately, it wasn't very clear to me how the result is pasted into the prompt
- we know that Fzf works out of the box with Bash history search, so we can try our luck reverse
  engineering how Bash and Fzf work so nicely together. See [Reversing Bash](#reversing-bash)
- turns out that Bash has a very simple implementation that gives us all the missing peices.
  - `maybe_make_readline_line` is a function in the Bash project (not in Readline), that basically
    just populates the prompt with a given string. Internally it calls `rl_insert_text`. We'll just
    copy paste that whole function from Bash.
  - `rl_forced_update_display` and `rl_crlf` are a couple of other functions we'll end up using

- TODO add section about `rl_line_buffer`, the current contents of the prompt




Dynamic analysis --- Bash
====================================================================================================
- know that both Bash and GDB use Readline

GDB doesn't give us the `bind -x` command like Bash does, so our quickest way forward is to just see
how Bash implements `bind -x` and try to replicate a small part of that in GDB.

The challenge is to pinpoint exactly which function in Bash executes the custom command. TODO
elaborate on where you got the idea "custom command" from.

OPTION 1: There are many ways to do this and you can get quite creative with this part. I'll use
GDB and `strace`.

OPTION 2: There are a couple of ways *that I thought of* for figuring this out. One would be to run Bash with

```bash
valgrind --tool=callgrind bin/bash
```

then take a look at the call graph using KCacheGrind.

But GDB itself is an epic tool, and we can get this done with GDB really quickly.

First, it's helpful to download and compile Bash with debug symbols in case your system's Bash is
stripped [Download and Compile Bash](#download-and-compile-bash). You can check if your system's
Bash is stripped by running (*it most likely is*)

```bash
$ file /bin/bash
/bin/bash: ELF 64-bit LSB ... for GNU/Linux 3.2.0, stripped
```

We'll use the `strace` command to trace the system calls that Bash makes while we press
<kbd>Ctrl-r</kbd>, then use that information to set a catchpoint in GDB.

Run the newly compiled Bash and grab it's PID

```bash
$ pgrep -n bash # PID of the youngest bash process
6225
```

Then attach with `strace`

```bash
$ strace -p 6225
strace: Process 6225 attached
pselect6(1, [0], NULL, NULL, NULL, {[], 8}
```

Now we can interact with Bash and watch the system calls that it makes when we press
<kbd>Ctrl-r</kbd>.

```bash
$ strace -p 6225
strace: Process 6225 attached
...
pipe([5, 6])                            = 0
clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID| ...
setpgid(6374, 6225)                     = 0
...
```

The most interesting line in the output is the call to `clone`, which is one of the system calls for
creating a new process (presumably the Fzf process). So if we could stop the Bash process in GDB at
the point where it makes the `clone` call, we could examine the backtrace to see which functions
were called leading up to that!

Kill the `strace` process and run `gdb -p 6225` followed by `catch syscall clone` and `continue`.
Pressing <kbd>Ctrl-r</kbd> in Bash now stops us at the syscall in GDB. The `backtrace` or `bt`
command will dump out the call stack.

```bash
...
#31 0x5654f528bec9 in parse_and_execute .. builtins/evalstring.c:436
#32 0x5654f527a2e9 in bash_execute_unix_command ...
#33 0x5654f52ac83d in _rl_dispatch_subseq lib/readline/readline.c:852
#34 0x5654f52acd21 in _rl_dispatch ... lib/readline/readline.c:798
...
```

The function is ~100 lines, most of which aren't useful, but the general structure gives us an idea
of what to do in GDB.

```c
static int
bash_execute_unix_command (count, key)
     int count;	/* ignored */
     int key;
{
  int type;
  register int i, r;
  intmax_t mi;
  sh_parser_state_t ps;
  char *cmd, *value, *ce, old_ch;
  SHELL_VAR *v;
  char ibuf[INT_STRLEN_BOUND(int) + 1];

  rl_crlf ();	/* move to a new line */

  r = parse_and_execute (savestring (cmd), "bash_execute_unix_command", SEVAL_NOHIST|SEVAL_NOFREE);

  maybe_make_readline_line (v ? value_cell (v) : 0);

  rl_forced_update_display ();

  return 0;
```

A quick look at the function `maybe_make_readline_line`, shows us that it's responsible for
populating the prompt with the new command (that was returned from Fzf). Since it's not a core
Readline function (it's actually a part of Bash), we'll have to copy paste that and reuse it in GDB. 

`rl_forced_update_display` is probably responsible for displaying the new prompt with the new
command so we'll take that over to GDB as well.

`rl_crlf` probably just prints a new line so lets just take that as well.

Now we have all the components we need to get this working!





Wrapping up
====================================================================================================

Now we have all the missing peices!

Let build this up incrementally. Back to our `Hello world!` example:

If instead we use `rl_insert_text`, instead of just `printf`, then hitting <kbd>Ctrl-r</kbd> will
truely paste `Hello world!` into our current prompt in addition to writing it to the terminal.

```diff
 int my_test(int sign, int key) {
-  printf("Hello world!");
+  rl_insert_text("Hello world!");
   return 0;
 }
```

![Hello world!](/assets/imgs/gdb_helloworld2.gif)

Now GDB is trying to run our `Hello world!` string!

So the path forward is clear. 

1. call Fzf
2. pass in the current history
3. get output
4. call `rl_insert_text`

1. call Fzf
  - Set up read and write pipes (via `pipe` syscall)
  - Fork a new process
  - launch Fzf via `execve` syscall
2. pass in the current history
  - call `history_list` function
  - write result into write pipe
  - fzf will receive that as its input
3. get output
  - Read from the read pipe (this will be the output of Fzf)
4. call `maybe_make_readline_line`
  - Interally this calls `rl_insert_text`
  - pass in the output we got from Fzf

If you're not interested in a detailed explanation of how to do this, checkout my github page TODO

XXX





Appendix
===================================================================================================


---



Infinite GDB history
---------------------------------------------------------------------------------------------------
You'll also probably want to set up infinite GDB history; add this to `~/.gdbinit`.

```bash
# https://stackoverflow.com/a/3176802/6824752
set history save on
set history size unlimited
set history remove-duplicates unlimited
set history filename ~/.gdb_eternal_history
```




<a name="modify"></a>
Wait, do we need to modify GDB source to pull this off?
----------------------------------------------------------------------------------------------------

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
  - valgrind
  - KCacheGrind
  - gdb catchpoint
- take smaller pics of the github issue to reduce cognitive overhead
- change "hitting" to "pressing"
- add section about gdbinit commands that give you inf history
- include info about linux distro
- So it turns out that you almost certainly can't pull this off without modifying readline in GDB.
  - See `bind -P | fzf` and look up `\e\C-e` which maps to shell expand. This is what execs the
    fzf_history command wrapped in $(). Only bash has that readline function.



## TLDR
- We know that fzf works with bash no problem. This is because of the bash builtin `bind` and the
  `-x` option
- So we'll look through the `bash` source code and see how they implement it.
- Copy pasta code from `bash` into `gdb`
- Compile a custom `gdb`
- A starting GIF does a better showcase of how actually useful it is to have fzf


Downloading and Compiling
====================================================================================================

GDB
-----------------------------------------------------------------------------------------------------
TODO Add section about build reqs
bison # sometimes
build-essential
### Downloading
```bash
# See all available versions here https://ftp.gnu.org/gnu/gdb/
wget https://ftp.gnu.org/gnu/gdb/gdb-9.1.tar.gz
# Extract
tar xzvf gdb-9.1.tar.gz
```
### Compiling
```bash
# This is the directory where we'll build GDB
mkdir build-gdb-9.1 && cd build-gdb-9.1

# Now configure the build
# Turn on debugging symbols with CFLAGS.
# --prefix is the root directory to install resulting files at
# --enable-targets=all gives us support for all architectures
CFLAGS="-ggdb -Og" ../gdb-9.1/configure \
    --prefix=$(pwd) \
    --with-python=$(which python) \
    --enable-targets=all

# ~5 minutes first time.
# Following builds will be much faster.
# gdb binary should appear in bin/ of the build directory
make -j $(nproc) && make install
```



Bash
-----------------------------------------------------------------------------------------------------
TODO Add section about build reqs
build-essential
### Downloading
```bash
# See all available versions https://ftp.gnu.org/gnu/bash/
wget https://ftp.gnu.org/gnu/bash/bash-5.0.tar.gz
# Extract
tar xzvf bash-5.0.tar.gz
```

### Compiling
```bash
# This is the directory where we'll build Bash
mkdir build-bash-5.0 && cd build-bash-5.0

# See section on compiling GDB for details on flags
CFLAGS="-ggdb -Og" ../bash-5.0/configure --prefix=$(pwd)

# Bash binary should appear in bin/ of the build directory
make -j $(nproc) && make install
```








Conceptualizing terminal programs
----------------------------------------------------------------------------------------------------

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
  disable <kbd>Ctrl-d</kbd> and <kbd>Ctrl-c</kbd> so that it doesn't kill the connected process.
  There are many options. Terminals truely are complicated devices that largely go unnoticed.
- TODO might be nice to do a section on how readline reads one char at a time from the terminal

```bash
$ lsof -p 5606
...
bash    5606   fk    0u   CHR  136,3      0t0        6 /dev/pts/3
bash    5606   fk    1u   CHR  136,3      0t0        6 /dev/pts/3
bash    5606   fk    2u   CHR  136,3      0t0        6 /dev/pts/3
```



What's Readline?
---------------------------------------------------------------------------------------------------
- what is readline
- [readline](https://en.wikipedia.org/wiki/GNU_Readline)
- basically it's some code that's typically compiled into interactive command line apps. It provides
  line editing capabilities, tab completion, etc. 
- an example of line editing would be holding backspace to delete what you've typed so far at your
  Bash prompt. Or simpler, using the <kbd>Ctrl-u</kbd> keybinding to delete everything behind the
  cursor.
  Readline handles all that.
- first terminal line editing is disabled (with ioctl)
- Bash hands off control over the terminal to readline
- readline handles reading the command
- when new line is entered, readline hands the typed command over to Bash, which then executes it
- when Bash is ready for a new command, it echos a new prompt and hands control over to Readline
  again.





![this issue](/assets/imgs/githubissue.png)


REMINDER FOR MYSELF ---------------------------------------------------------------------
The order in which I did things while reversing
- I poked around gdb source looking at readline specifically
- I messed around with callgrind
- I found that `_rl_dispatch` was responsible for choosing the function to exec from the keymap
- once I had that I decided I'd just copy what bash was doing
- NOTE the reason I was looking at bash in the first place, was actually just to see how they
  implemented the function that runs your custom command
- so set a break at `_rl_dispatch` and started debugging bash
- then I basically copied bash's implementation to gdb



Haven't decided where to put these points yet ----------------------------------------------------
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
