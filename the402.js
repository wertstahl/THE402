/*
THE402 (c) 2008 - 2022 SyS Audio Research
__type: js
__version: 0.4
__author: Rego Sen
__additional-code: D. Zahn
__additional-code: S. I. Hartmann
*/

$(document).ready(() => {
  // CONSTANTS
  const WAVES_IN_WINDOW = 100; // number of peak+vally square waves in canvas
  const SAMPLES_IN_WINDOW = 1024; // number of samples represented in canvas
  const NOTIFICATION_MS = 1000;
  const FADE_MS = 200;
  const LICENSE_MESSAGE = "You are welcome to use this loop in a non-commercial fashion, royalty free, after getting written permission by sending an email to info@battlecommand.org";
  
  const LOOPS_REPOSITORY = 'https://the402.wertstahl.de';
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
  };
  const [ DEFAULT_FILTER ] = Object.keys(PLAYLIST_FILTERS);
  
  // hold modes are cycled in the order below
  // keys match "mode" attributes for "hold-mode" button in CSS file
  // value is [min, max] or [constant] number of repeats
  const HOLD_MODES = {
    rnd24: [2, 4],
    hold: [0], // Repeat single loop forever
    rnd: [1, 8],
    off: [1], // Play each loop once
  };
  const [ DEFAULT_MODE ] = Object.keys(HOLD_MODES);

  // CONFIG
  const queryParams = new URLSearchParams(window.location.search);
  // automated query params (e.g. from shared link)
  const startMode = queryParams.get('mode') || DEFAULT_MODE;
  const startLoop = queryParams.get('id');
  const startFilter = queryParams.get('filter') || DEFAULT_FILTER;
  // manual query params
  const loadLimit = parseInt(queryParams.get('loadLimit') || 5);
  const quality = queryParams.get('quality') || 'low';  // low, high

  // UTILITIES
  const toFilename = (path) => path.replace(/^.*[\\\/]/, '');
  const toExt = (path) => path.split('.').pop();
  const toTokens = (path) => toFilename(path).split('.')[0].split('_');
  const getLoopsPath = (path) => `${LOOPS_REPOSITORY}/${quality}/${path}`;
  const looperTransportButton = (target) => $(`.looper-transport button[target=${target}]`);

  // STATE
  let playOnLoad = false;
  let preserveLoopState = false;
  const loadedAudio = {}; // for visualizer, downloads, enabling prev/next, etc.
  const loopState = { forever: false, min: 1, max: 1 };
  const getLoopHold = () => loopState.forever || (loopState.current < loopState.last - 1);

  // CONTEXTS
  const gapless = new Gapless5({
    loop: true,
    singleMode: false,
    useHTML5Audio: false, // save memory
    loadLimit,
    shuffle: false, // we handle (re-)shuffling ourselves
    logLevel: LogLevel.Info, // LogLevel.Debug,
  });
  gapless.onloadstart = (audioPath) => {
    const fileName = toFilename(audioPath);
    const mediaType = EXT_TO_TYPE[toExt(audioPath).toLowerCase()];
    fetch(audioPath).then((response) => response.blob())
    .then((blob) => {
      const file = new File([ blob ], fileName, { type: mediaType });
      loadedAudio[audioPath] = URL.createObjectURL(file);
      updateTransportButtons();
      if (playOnLoad && audioPath === gapless.getTracks()[0]) {
        playOnLoad = false;
        playLoop(audioPath);
      }
    }).catch((err) => console.error(err));
  };
  gapless.onload = () => {
    updateTransportButtons();
  }
  gapless.onunload = (audioPath) => {
    URL.revokeObjectURL(loadedAudio[audioPath]);
    delete loadedAudio[audioPath];
  };
  gapless.onfinishedtrack = () => {
    resetCurrentLoopProgress();
    continuity(getLoop());
  };

  // Local audio context for visualizer and progress bar
  const looper = document.querySelector('audio');
  const audioContext = new AudioContext();
  const analyser = function() {
    const analyserNode = audioContext.createAnalyser();
    const track = audioContext.createMediaElementSource(looper);
    track.connect(analyserNode);
  
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(audioContext.destination);
    analyserNode.connect(gainNode);
    analyserNode.fftSize = SAMPLES_IN_WINDOW;
    return analyserNode;
  }();

  // CONTEXT UTILITIES
  const getLoop = (offset = 0) => gapless.getTracks()[gapless.getIndex() + offset];
  const getPrev = () => getLoop(-1);
  const getNext = () => getLoop(1);

  function buildLoops(firstLoop) {
    const filterMode = $('#filter-selection').attr('mode');
    const filterRegex = PLAYLIST_FILTERS[filterMode];

    // Fetches from 'file://...' are not supported
    // To run locally, call 'python -m http.server 8000' and visit http://localhost:8000
    if (window.location.protocol !== 'file:') {
      const listPath = getLoopsPath('list.txt');
      fetch(listPath)
        .then((response) => response.text())
        .then((text) => {
          const orderedLoops = text.trim().split('\n');
          const getLoopIndex = (a) => (firstLoop === toTokens(a)[0]) ? -1 : Math.random();
          const loops = orderedLoops.map(a => ({ sort: getLoopIndex(a), value: a })).sort((a, b) => a.sort - b.sort).map(a => a.value);
          for (let i = 0; i < loops.length; i++) {
            if (loops[i].match(filterRegex)) {
              const audioPath = getLoopsPath(loops[i]);
              gapless.addTrack(audioPath);
            }
          }
        })
        .catch(() => alert(`Failed to fetch list from ${listPath}`));
    }
  }
  $('#filter-selection').attr('mode', startFilter);
  buildLoops(startLoop);
  
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
  
    const draw = () => {
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
  armLooperTransport();

  // provide looper events
  armLooperEvents();
  
  function armLooperEvents() {
    // provide progress bar
    looper.addEventListener("timeupdate", () => {
      const { currentTime, duration } = looper;
      if (currentTime === 0) {
        $("#loop-progress").stop(true, true).animate({ width:'0%' }, 10, 'linear');
      } else {
        $("#loop-progress").stop(true, true).animate({ width:`${100.0 * (currentTime + 0.4) / duration }%` }, FADE_MS, 'linear');
      }
    });
  }
  
  function enableTransportButton(target, enable) {
    if (enable) {
      looperTransportButton(target).removeClass("disabled");
    } else {
      looperTransportButton(target).addClass("disabled");
    }
  };

  function resetCurrentLoopProgress() {
    looperTransportButton("play-pause").attr("mode", "play");
    $("#loop-title").text("");
    $("#loop-name").text("");
    $("#loop-tempo").text("");
    $("#loop-progress").stop(true, true).animate({ width:'0%' }, 10, 'linear');
    updateTransportButtons();
    updateSequenceIndicator();
  }
  
  function updateSequenceIndicator() {
    const sequenceIndicator = document.querySelector('#loop-sequence');
    sequenceIndicator.replaceChildren([]);
    if (!loopState.forever) {
      for (i=0; i<loopState.last; i++) {
        const ball = document.createElement('div');
        const hasPlayed = i >= (loopState.last - loopState.current);
        ball.className = 'loop-sequence-indicator';
        ball.setAttribute('mode', hasPlayed ? 'played' : 'unplayed')
        sequenceIndicator.appendChild(ball);
      }
    }
  }

  function resetLoopState() {
    if (loopState.forever) {
      gapless.singleMode = true;
    } else {
      loopState.last = loopState.min + Math.round(Math.random() * (loopState.max - loopState.min));
      loopState.current = 0;
      gapless.singleMode = getLoopHold();
    }
    gapless.loop = gapless.singleMode;
    updateSequenceIndicator();
  }

  // which loop is playing next
  function continuity(audioPath) {
    if (!audioPath) {
      audioPath = getLoop();
    }
    let nextPath = audioPath;
    if (getLoopHold()) {
      loopState.current += 1;
      gapless.singleMode = loopState.forever || getLoopHold();
      gapless.loop = gapless.singleMode;
      updateSequenceIndicator();
    } else if (!loopState.forever) {
      nextPath = gapless.getTracks()[gapless.findTrack(audioPath) + 1];
      if (nextPath === undefined) {
        // re-shuffle at end of playlist
        resetTracks(true);
        return;
      }
      resetLoopState();
    }
    playLoop(nextPath, false);
  }

  function playLoop(audioPath, playAudio = true) {
    looper.pause();

    // if idle, do something
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    let paused = false;
    if (audioPath !== getLoop() || looper.src === '') {
      // switching to a new track
      if (playAudio) {
        if (!preserveLoopState) {
          resetLoopState();
        } else {
          preserveLoopState = false;
        }
        gapless.gotoTrack(audioPath);
        gapless.play();
      }
      looper.src = loadedAudio[getLoop()];
      looper.load();
      looper.play();
    } else if (!gapless.isPlaying()) {
      // unpausing
      if (playAudio) {
        gapless.play();
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
        gapless.pause();
      }
      looper.pause();
    }

    if (paused) {
      $("#loop-visualizer").fadeOut(FADE_MS);
    } else {
      $("#loop-visualizer").fadeIn(FADE_MS);
    }
    looperTransportButton("play-pause").attr("mode", paused ? "play" : "pause");
    updateTransportButtons();
  }

  function updateTransportButtons() {
    const audioPath = getLoop();
    const canPlay = audioPath in loadedAudio;
    enableTransportButton("play-pause", canPlay);
    enableTransportButton("share-link", canPlay);
    enableTransportButton("download", canPlay);
    enableTransportButton("hold-mode", true); // hold mode can be changed regardless of state

    if (audioPath) {
      const [ id, tempo, name ] = toTokens(audioPath);
      $("#loop-title").text(id);
      $("#loop-name").text(name);
      $("#loop-tempo").text(`${tempo} BPM`);
    }
    if (!canPlay) {
      enableTransportButton("prev-loop", false);
      enableTransportButton("next-loop", false);
    } else if (gapless.getIndex() >= 0) {
      // disable prev/next based on if playing first or last track
      enableTransportButton("prev-loop", gapless.isPlaying() && getPrev() in loadedAudio);
      enableTransportButton("next-loop", gapless.isPlaying() && getNext() in loadedAudio);
    }
  }

  function resetTracks(forcePlay = false) {
    looper.pause();
    looper.removeAttribute('src');
    $("#loop-visualizer").fadeOut(FADE_MS);
    resetCurrentLoopProgress();
    gapless.stop();
    gapless.removeAllTracks();
    for (const audioPath in loadedAudio) {
      URL.revokeObjectURL(loadedAudio[audioPath]);
      delete loadedAudio[audioPath];
    }
    updateTransportButtons();
    playOnLoad = forcePlay;
    buildLoops();
    resetLoopState();
  }

  function setHoldMode(mode) {
    looperTransportButton("hold-mode").attr("mode", mode);
    [holdMin, holdMax] = HOLD_MODES[mode] || HOLD_MODES[DEFAULT_MODE];
    if (holdMin === 0 || holdMax === 0) {
      loopState.forever = true;
    } else {
      loopState.forever = false;
      loopState.min = holdMin;
      loopState.max = holdMax || holdMin;
    }
    resetLoopState();
    updateTransportButtons();
  }
  setHoldMode(startMode);
  preserveLoopState = true;

  function downloadContent(content, type, filename) {
    const link = document.createElement("a");
    const file = new File([ content ], filename, { type });
    const blobURL = URL.createObjectURL(file);
    link.href = blobURL;
    link.setAttribute("download", filename);
    link.click();
  };

  // arm all buttons which belong into looper-transport
  function armLooperTransport() {
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

    setupButton("share-link", () => {
      const [ loopId ] = toTokens(getLoop());
      const [ url ] = document.URL.split('?');
      const filter = $('#filter-selection').attr('mode');
      const newLink = `${url}?id=${loopId}&mode=hold&filter=${filter}`;
      navigator.clipboard.writeText(newLink);
      $("#notification_banner").fadeIn(FADE_MS,
        () => setTimeout(
          () => $("#notification_banner").fadeOut(FADE_MS),
          NOTIFICATION_MS,
        ),
      );
    });

    setupButton("hold-mode", (selector) => {
      const modes = Object.keys(HOLD_MODES);
      const prevIndex = modes.indexOf(selector.attr("mode"));
      const nextIndex = prevIndex === modes.length - 1 ? 0 : prevIndex + 1;
      setHoldMode(modes[nextIndex]);
    });

    setupButton("play-pause", () => {
      if (gapless.getIndex() === -1) {
        playLoop(gapless.getTracks()[0]);
      } else {
        playLoop(getLoop());
      }
    });

    setupButton("prev-loop", () => playLoop(getPrev()));

    setupButton("next-loop", () => playLoop(getNext()));

    setupButton("download", () => {
      const audioPath = getLoop();
      fetch(loadedAudio[audioPath]).then(r => {
        r.blob().then(audioFile => {
          const zip = new JSZip();
          zip.file("license.txt", LICENSE_MESSAGE);
          zip.file(toFilename(audioPath), audioFile);
          zip.generateAsync({type:"blob"})
          .then(content => {
            downloadContent(content, 'application/zip', `${toFilename(audioPath)}.zip`);
          });
        })
      });
    });

    // bottom panel toggling
    $('#credits-toggle').off().on("click", () => {
      $('#banner-filters').hide();
      $('#banner-credits').css('display', 'flex');
    });

    $('#close-toggle').off().on("click", () => {
      $('#banner-filters').css('display', 'block');
      $('#banner-credits').hide();
    });

    // bottom panel filtering
    Object.keys(PLAYLIST_FILTERS).forEach((filterMode) => {
      $(`.filter-button[target="${filterMode}"`).off().on("click", () => {
        if ($('#filter-selection').attr('mode') !== filterMode) {
          $('#filter-selection').attr('mode', filterMode);
          resetTracks();
        }
      });
    });
  }
});
