/*
THE402 (c) 2008 - 2022 SyS Audio Research
__type: js
__version: 0.4
__author: Rego Sen
__additional-code: D. Zahn
__additional-code: S. I. Hartmann
*/

$(document).ready(() => {
  const WAVES_IN_WINDOW = 100; // number of peak+vally square waves in canvas
  const SAMPLES_IN_WINDOW = 1024; // number of samples represented in canvas
  const LICENSE_MESSAGE = "You are welcome to use this loop in a non-commercial fashion, royalty free, after getting written permission by sending an email to info@battlecommand.org";
  
  // options are low, med, high
  const queryParams = new URLSearchParams(window.location.search);
  const quality = queryParams.get('quality') || 'low';
  const LOOPS_REPOSITORY = `https://the402.wertstahl.de/${quality}`;
  const EXT_TO_TYPE = {
    wav: 'audio/x-wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
  };
  const PLAYLIST_FILTERS = {
    'select1': '',
    'select2': /\d+D_.*/,
    'select3': /\d+A_.*/,
  }
  const HOLD_MODES = [
    [2, 4],
    [1, 8],
    [0, 0], // forever hold
    [1, 1], // no hold (play once)
  ];
  const maxLoops = parseInt(queryParams.get('maxLoops') || -1);
  const loadLimit = parseInt(queryParams.get('loadLimit') || 5);
  const toFilename = (path) => path.replace(/^.*[\\\/]/, '');

  const looperTransportButton = (target) => $(`.looper-transport button[target=${target}]`);
  const sequenceIndicator = document.querySelector('#loop-sequence');

  let playOnLoad = false;
  const audioContext = new AudioContext();
  const loadedAudio = {}; // for visualizer
  const analyser = audioContext.createAnalyser();
  const loop_state = { forever: false, min: 1, max: 1 };
  const get_loop_hold = () => loop_state.forever || (loop_state.current < loop_state.last - 1);
  const get_loops_remaining = () => loop_state.forever ? -1 : (loop_state.last - loop_state.current);

  // A wrapper for 2 Gapless5 players to cross-fade between tracks, etc
  function Gapless5Wrapper(inLoadLimit) {
    const gaplessOptions = {
      loop: false, // we handle looping ourselves, so that we can re-shuffle beforehand
      singleMode: false,
      useHTML5Audio: false, // save memory
      loadLimit: inLoadLimit,
      shuffle: false, // we handle (re-)shuffling ourselves
      logLevel: LogLevel.Info, // LogLevel.Debug,
    };
    const players = [
      new Gapless5(gaplessOptions), // even tracks
      new Gapless5(gaplessOptions), // odd tracks
    ];

    let tempo = 0; // use whatever first track you play
    const getTempo = (audio_path) => toFilename(audio_path).split('.')[0].split('_')[1] * 1;

    let index = 0;

    this.current = () => players[index % 2];
    this.standby = () => players[(index + 1) % 2];
    this.forEach = (func) => {
      players.forEach(player => func(player));
    };
    this.onfinishedtrack = () => {};
    this.numTracks = () => this.current().getTracks().length;
    this.getPlaybackRate = (track) => tempo / getTempo(track.currentSource().audioPath);

    this.gotoTrack = (audio_path) => {
      if (tempo === 0) {
        tempo = getTempo(audio_path);
      }
      index = players[0].findTrack(audio_path);
      const currentTrack = this.current();
      currentTrack.gotoTrack(index);
      currentTrack.setPlaybackRate(this.getPlaybackRate(currentTrack));
      currentTrack.setVolume(1);
      currentTrack.onfinishedtrack = this.onfinishedtrack;

      const standbyTrack = this.standby();
      standbyTrack.gotoTrack((index + 1) % this.numTracks());
      standbyTrack.setPlaybackRate(this.getPlaybackRate(standbyTrack));
      standbyTrack.setVolume(0);
      standbyTrack.onfinishedtrack = () => {};
    };

    this.onStartedTrack = (reps_left) => {
      if (reps_left === 1) {
        const currentTrack = this.current();
        const standbyTrack = this.standby();
        const duration = currentTrack.currentSource().getDuration() / this.getPlaybackRate(currentTrack);
        const duration2 = standbyTrack.currentSource().getDuration() / this.getPlaybackRate(standbyTrack);
        currentTrack.setVolume(0, duration);
        standbyTrack.setVolume(1, duration2);
      }
    }

  };
  const gapless = new Gapless5Wrapper(loadLimit);

  set_hold_mode(0);
  
  gapless.forEach(player => player.onloadstart = (audio_path) => {
    const file_name = toFilename(audio_path);
    const ext = file_name.split('.')[1].toLowerCase();
    const mediaType = EXT_TO_TYPE[ext];
    fetch(audio_path).then((response) => response.blob())
    .then((blob) => {
      const file = new File([ blob ], file_name, { type: mediaType });
      const blobURL = URL.createObjectURL(file);
      loadedAudio[audio_path] = blobURL;
      update_transport_buttons();
      if (playOnLoad && audio_path === gapless.current().getTracks()[0]) {
        playOnLoad = false;
        play_loop(audio_path);
      }
    }).catch((err) => console.error(err));
  });
  gapless.forEach(player => player.onload = () => {
    update_transport_buttons();
  });
  gapless.forEach(player => player.onunload = (audio_path) => {
    URL.revokeObjectURL(loadedAudio[audio_path]);
    delete loadedAudio[audio_path];
  });

  function build_loops() {
    const filter_mode = $('#filter-selection').attr('mode');
    const filter_regex = PLAYLIST_FILTERS[filter_mode];

    // Fetches from 'file://...' are not supported
    // To run locally, call 'python -m http.server 8000' and visit http://localhost:8000
    if (window.location.protocol !== 'file:') {
      const list_path = `${LOOPS_REPOSITORY}/list.txt`;
      fetch(list_path)
        .then((response) => response.text())
        .then((text) => {
          const ordered_loops = text.trim().split('\n');
          const loops = ordered_loops.map(a => ({ sort: Math.random(), value: a })).sort((a, b) => a.sort - b.sort).map(a => a.value);
          const num_loops = maxLoops >= 0 ? maxLoops : loops.length;
          for (let i = 0; i < num_loops; i++) {
            if (loops[i].match(filter_regex)) {
              const audio_path = `${LOOPS_REPOSITORY}/${loops[i]}`;
              gapless.forEach(player => player.addTrack(audio_path));
            }
          }
        })
        .catch(() => alert(`Failed to fetch list from ${list_path}`));
    }
  }
  build_loops();
  
  // create audio element from audio element. 1 naise sache.
  const looper = document.querySelector('audio');
  // init track object for audio context as media element source
  const track = audioContext.createMediaElementSource(looper);
  track.connect(analyser);

  // silence loop
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(audioContext.destination);
  analyser.connect(gainNode);
  analyser.fftSize = SAMPLES_IN_WINDOW;

  // define analyser canvas
  function visualize() {
    const canvas = document.querySelector('#loop-visualizer');
    const canvasCtx = canvas.getContext("2d");

    const bufferLength = analyser.fftSize;
    const arrayBuffer = new Uint8Array(bufferLength);

    const filterData = rawData => {
      const blockSize = Math.floor(rawData.length / WAVES_IN_WINDOW); // the number of samples in each subdivision
      const filteredData = [];
      for (let i = 0; i < WAVES_IN_WINDOW; i++) {
        let blockStart = blockSize * i; // the location of the first sample in the block
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]) // find the sum of all the samples in the block
        }
        filteredData.push(sum / blockSize); // divide the sum by the block size to get the average
      }
      return filteredData;
    }
  
    const normalizeData = filteredData => {
      const multiplier = Math.pow(Math.max(...filteredData), -1);
      return filteredData.map(n => n * multiplier);
    }    
    
    const drawLineSegment = (ctx, x, y, width, isEven) => {
      ctx.lineWidth = 1; // how thick the line is
      ctx.strokeStyle = "#000"; // what color our line is
      ctx.beginPath();
      y = isEven ? y : -y;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, y);
      ctx.arc(x + width / 2, y, width / 2, Math.PI, 0, isEven);
      ctx.lineTo(x + width, 0);
      ctx.stroke();
    };
  
    const draw = function() {
      requestAnimationFrame(draw);
      const canvasState = $('#loop-visualizer');
      canvas.width = canvasState.width();
      canvas.height = canvasState.height();
      canvasCtx.translate(0, canvas.height / 2); // Set Y = 0 to be in the middle of the canvas
      canvasCtx.scale(1, 0.5); // give it some vertical padding
  
      analyser.getByteTimeDomainData(arrayBuffer);
      const filteredData = filterData(arrayBuffer);
      const normalizedData = normalizeData(filteredData);
      
      // draw the line segments
      canvasCtx.clearRect(0, -canvas.height/2, canvas.width, canvas.height);
      const width = canvas.width / normalizedData.length;
      const height = canvas.height / 2;
      for (let i = 0; i < normalizedData.length; i++) {
        const x = width * i;
        const y = height * normalizedData[i];
        drawLineSegment(canvasCtx, x, y, width, (i + 1) % 2);
      }
    };
    draw();
  }
  visualize();

  // provide transport button events
  arm_looper_transport();

  // provide looper events
  arm_looper_events();

  function get_loop() { return gapless.current().getTracks()[gapless.current().getIndex()]; }
  function get_prev() { return gapless.current().getTracks()[gapless.current().getIndex() - 1]; }
  function get_next() { return gapless.current().getTracks()[gapless.current().getIndex() + 1]; }
  
  function arm_looper_events() {
    // provide progress bar
    looper.addEventListener("timeupdate", () => {
      const { currentTime, duration } = looper;
      if (currentTime === 0) {
        $("#loop-progress").stop(true, true).animate({ width:'0%' }, 10, 'linear');
      } else {
        $("#loop-progress").stop(true, true).animate({ width:`${100.0 * (currentTime + 0.4) / duration }%` }, 200, 'linear');
      }
    });

    // remove playing attribute when loop ended
    gapless.onfinishedtrack = function() {
      reset_current_loop_progress();
      continuity(get_loop());
    };
  }

  function enableButton(target, enable) {
    if (enable) {
      target.removeClass("disabled");
    } else {
      target.addClass("disabled");
    }
  };
  
  function enableTransportButton(target, enable) {
    enableButton(looperTransportButton(target), enable);
  };

  function reset_current_loop_progress() {
    enableButton($("button[target=remove-loop]"), true);
    looperTransportButton("play-pause").attr("mode", "play");
    $("#loop-name").text("");
    $("#loop-tempo").text("");
    $("#loop-progress").stop(true, true).animate({ width:'0%' }, 10, 'linear');
    update_transport_buttons();
    update_sequence_indicator();
  }
  
  function update_sequence_indicator() {
    sequenceIndicator.replaceChildren([]);
    if (!loop_state.forever) {
      for (i=0; i<loop_state.last; i++) {
        const ball = document.createElement('div');
        const hasPlayed = i >= (loop_state.last - loop_state.current);
        ball.className = 'loop-sequence-indicator';
        ball.setAttribute('mode', hasPlayed ? 'played' : 'unplayed')
        sequenceIndicator.appendChild(ball);
      }
    }
  }

  function reset_loop_state() {
    if (loop_state.forever) {
      gapless.forEach((player) => { player.singleMode = true });
    } else {
      loop_state.last = loop_state.min + Math.round(Math.random() * (loop_state.max - loop_state.min));
      loop_state.current = 0;
      gapless.forEach((player) => { player.singleMode = get_loop_hold() });
    }
    gapless.forEach((player) => { player.loop = player.singleMode });
    update_sequence_indicator();
  }
  reset_loop_state();

  // which loop is playing next
  function continuity(audio_path) {
    if (!audio_path) {
      audio_path = get_loop();
    }
    let next_path = audio_path;
    if (get_loop_hold()) {
      loop_state.current += 1;
      gapless.forEach((player) => {
        player.singleMode = loop_state.forever || get_loop_hold();
        player.loop = player.singleMode;
      });
      update_sequence_indicator();
    } else if (!loop_state.forever) {
      next_path = gapless.current().getTracks()[gapless.current().findTrack(audio_path) + 1];
      if (next_path === undefined) {
        // re-shuffle at end of playlist
        reset_tracks(true);
        return;
      }
      reset_loop_state();
    }
    play_loop(next_path, false);
    gapless.onStartedTrack(get_loops_remaining());
  }

  function play_loop(audio_path, playAudio = true) {
    looper.pause();

    // if idle, do something
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    let paused = false;
    if (audio_path !== get_loop() || looper.src === '') {
      // switching to a new track
      if (playAudio) {
        reset_loop_state();
        gapless.gotoTrack(audio_path);
        looper.playbackRate = gapless.getPlaybackRate(gapless.current());
        gapless.forEach((player) => { 
          player.play();
         });
        gapless.onStartedTrack(get_loops_remaining());
      }
    } else if (!gapless.current().isPlaying()) {
      // unpausing
      if (playAudio) {
        gapless.forEach((player) => { player.play() });
      }
      looper.play();
    } else if (looperTransportButton("play-pause").attr("mode") === "play") {
      // repeating track
      looper.load();
      looper.play();
    } else {
      // pausing
      paused = true;
      if (playAudio) {
        gapless.forEach((player) => { player.pause() });
      }
      looper.pause();
    }

    if (paused) {
      $("#loop-visualizer").fadeOut(200);
    } else {
      $("#loop-visualizer").fadeIn(200);
    }
    looperTransportButton("play-pause").attr("mode", paused ? "play" : "pause");
    update_transport_buttons();
  }

  function update_transport_buttons() {
    const audio_path = get_loop();
    const canPlay = audio_path in loadedAudio;
    enableTransportButton("play-pause", canPlay);
    enableTransportButton("hold-mode", canPlay);
    enableTransportButton("download", canPlay);

    if (audio_path) {
      const [id, tempo, _name] = toFilename(audio_path).split('.')[0].split('_');
      $("#loop-name").text(id);
      $("#loop-tempo").text(`${tempo} BPM`);
    }

    if (gapless.current().getIndex() >= 0) {
      // don't allow shuffle if a track is playing or paused
      enableTransportButton("shuffle-loops", !gapless.current().isPlaying());

      // disable prev/next based on if playing first or last track
      enableTransportButton("prev-loop", gapless.current().isPlaying() && get_prev() in loadedAudio);
      enableTransportButton("next-loop", gapless.current().isPlaying() && get_next() in loadedAudio);
    }
  }

  function reset_tracks(forcePlay = false) {
    looper.pause();
    looper.removeAttribute('src');
    reset_current_loop_progress();
    gapless.forEach(player => {
      player.stop;
      player.removeAllTracks();
    });
    for (const audio_path in loadedAudio) {
      delete loadedAudio[audio_path];
    }
    update_transport_buttons();
    playOnLoad = forcePlay;
    build_loops();
  }

  function set_hold_mode(mode_index) {
    [hold_min, hold_max] = HOLD_MODES[mode_index];
    if (hold_min === 0 || hold_max === 0) {
      loop_state.forever = true;
    } else {
      loop_state.forever = false;
      loop_state.min = hold_min;
      loop_state.max = hold_max;
    }
    reset_loop_state();
    update_transport_buttons();
  }

  function download_content(content, type, filename) {
    const link = document.createElement("a");
    const file = new File([ content ], filename, { type });
    const blobURL = URL.createObjectURL(file);
    link.href = blobURL;
    link.setAttribute("download", filename);
    link.click();
  };

  // arm all buttons which belong into looper-transport
  function arm_looper_transport() {
    const setupButton = (target, onClick) => {
      const button = looperTransportButton(target);
      button.animate({ backgroundSize: '75%' }, 0);
      button.off().on("click", function() {
        if (!$(this).hasClass("disabled")) {
          $(this).animate({ backgroundSize: '50%' }, 50, 'linear', function() {
            $(this).animate({ backgroundSize: '75%' }, 50, 'linear'); }
          );
          onClick($(this));
        }
      });
    };

    setupButton("shuffle-loops", function() {
      reset_tracks();
    });

    setupButton("hold-mode", function(selector) {
      const prevIndex = parseInt(selector.attr("mode"));
      const nextIndex = prevIndex === HOLD_MODES.length - 1 ? 0 : prevIndex + 1;
      selector.attr("mode", nextIndex);
      set_hold_mode(nextIndex);
    });

    setupButton("play-pause", function() {
      if (gapless.getIndex() === -1) {
        play_loop(gapless.current().getTracks()[0]);
      } else {
        play_loop(get_loop());
      }
    });

    setupButton("prev-loop", function() {
      play_loop(get_prev());
    });

    setupButton("next-loop", function() {
      play_loop(get_next());
    });

    setupButton("download", function() {
      const audio_path = get_loop();
      fetch(loadedAudio[audio_path]).then(r => {
        r.blob().then(audioFile => {
          const zip = new JSZip();
          zip.file("license.txt", LICENSE_MESSAGE);
          zip.file(toFilename(audio_path), audioFile);
          zip.generateAsync({type:"blob"})
          .then(function(content) {
            download_content(content, 'application/zip', `${toFilename(audio_path)}.zip`);
          });
        })
      });
    });

    // bottom panel toggling
    $('#credits-toggle').off().on("click", function() {
      $('#banner-filters').hide();
      $('#banner-credits').css('display', 'flex');
    });

    $('#close-toggle').off().on("click", function() {
      $('#banner-filters').css('display', 'block');
      $('#banner-credits').hide();
    });

    // bottom panel filtering
    Object.keys(PLAYLIST_FILTERS).forEach((filter_mode) => {
      $(`.filter-button[target="${filter_mode}"`).off().on("click", function() {
        if ($('#filter-selection').attr('mode') !== filter_mode) {
          $('#filter-selection').attr('mode', filter_mode);
          reset_tracks();
        }
      });
    });
  }
});
