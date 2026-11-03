(() => {
  const $ = (selector) => document.querySelector(selector);
  const els = {
    connectionBadge: $('#connectionBadge'), connectionText: $('#connectionText'),
    emptyScreen: $('#emptyScreen'), screenVideo: $('#screenVideo'), uploadedImage: $('#uploadedImage'), demoScreen: $('#demoScreen'),
    screenStage: $('#screenStage'), screenModeLabel: $('#screenModeLabel'), screenSourceText: $('#screenSourceText'),
    shareScreenButton: $('#shareScreenButton'), screenshotInput: $('#screenshotInput'), clearScreenButton: $('#clearScreenButton'),
    explainScreenButton: $('#explainScreenButton'), screenOverlay: $('#screenOverlay'), overlayText: $('#overlayText'),
    startDemoButton: $('#startDemoButton'), goalInput: $('#goalInput'), languageSelect: $('#languageSelect'), guideButton: $('#guideButton'),
    welcomeMessage: $('#welcomeMessage'), analysisResult: $('#analysisResult'), responseState: $('#responseState'),
    chatHistory: $('#chatHistory'), replyRow: $('#replyRow'), replyInput: $('#replyInput'), replyButton: $('#replyButton'),
    toast: $('#toast'), micButton: $('#micButton'), helpModal: $('#helpModal')
  };

  let aiReady = false;
  let screenStream = null;
  let currentScreenMode = 'empty'; // empty | live | upload | demo
  let currentImageDataUrl = null;
  let demoStage = 0;
  let lastSpeechText = '';
  let recognition = null;
  let pendingContext = '';
  let apiBusy = false;

  const demoGuidance = [
    {
      title: 'Start with the journey details',
      summary: 'This is a practice version of a train-booking page. You can try it safely; it will not contact a railway service or book a real ticket.',
      action: 'Enter your starting station, destination and travel date. Then choose “Search trains”.',
      steps: [
        ['Enter the starting station', 'In the “From” box, enter the station where the journey begins.', 'From'],
        ['Enter the destination', 'In the “To” box, enter where you want to go.', 'To'],
        ['Choose a travel date', 'Select the date you want to travel.', 'Journey date']
      ], follow: 'When the journey details look right, select “Search trains”.'
    },
    {
      title: 'Choose a train',
      summary: 'The practice page is showing sample train options. The times and prices below are made up for this demonstration.',
      action: 'Compare the departure time and sample fare, then choose “Select” beside one train.',
      steps: [
        ['Compare the options', 'Look at the train name, departure time and arrival time.', 'Train options'],
        ['Choose one option', 'Select the train that suits your schedule. This is only a practice selection.', 'Select']
      ], follow: 'After choosing a train, the passenger-details page will open.'
    },
    {
      title: 'Add passenger details',
      summary: 'This page asks who will travel. Use made-up details for this practice flow; do not enter real personal information.',
      action: 'Enter a sample name and age, choose a gender option, then select “Continue”.',
      steps: [
        ['Enter a sample name', 'Type any practice name. Do not use someone else’s real details.', 'Passenger name'],
        ['Enter an age', 'Enter a sample age using numbers only.', 'Age'],
        ['Continue to review', 'Check the sample details and select “Continue”.', 'Continue']
      ], follow: 'The next page will show a sample booking summary.'
    },
    {
      title: 'Review before payment',
      summary: 'You are at the final review stage of this simulated booking. No real money will be collected.',
      action: 'Check the route, date and sample amount. Then choose “Complete practice booking”.',
      steps: [
        ['Review the details', 'Make sure the sample route and date look correct.', 'Booking summary'],
        ['Finish the practice', 'Select “Complete practice booking”. This only completes the demo.', 'Complete practice booking']
      ], follow: 'You will see a practice confirmation. No actual ticket is issued.'
    },
    {
      title: 'You completed the practice journey!',
      summary: 'Nice work. You moved through the key stages of a ticket-booking flow: journey details, train selection, passenger details and final review.',
      action: 'Try the flow again, or share a real app screen and I can guide you through its visible interface.',
      steps: [
        ['What you learned', 'Most booking flows follow a similar pattern: search, compare, enter details and review.', 'Practice complete'],
        ['Remember', 'On a real payment page, verify the merchant and final amount yourself. Never share an OTP or UPI PIN with anyone.', 'Safety check']
      ], follow: 'Would you like to practise another task or explain a real screen?'
    }
  ];

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => els.toast.classList.remove('show'), 3200);
  }

  function setResponseState(text, working = false) {
    els.responseState.textContent = text;
    els.responseState.classList.toggle('working', working);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  async function checkStatus() {
    try {
      const response = await fetch('/api/status');
      const status = await response.json();
      aiReady = Boolean(status.aiReady);
      els.connectionBadge.classList.toggle('demo', !aiReady);
      els.connectionText.textContent = aiReady ? `AI connected · ${status.model}` : 'Practice mode';
    } catch {
      aiReady = false;
      els.connectionBadge.classList.add('demo');
      els.connectionText.textContent = 'Local demo';
    }
  }

  function stopScreenShare() {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    els.screenVideo.pause();
    els.screenVideo.srcObject = null;
  }

  function resetScreen() {
    stopScreenShare();
    currentScreenMode = 'empty';
    currentImageDataUrl = null;
    demoStage = 0;
    els.emptyScreen.hidden = false;
    els.screenVideo.hidden = true;
    els.uploadedImage.hidden = true;
    els.demoScreen.hidden = true;
    els.screenStage.classList.remove('has-image');
    els.screenModeLabel.textContent = 'Screen preview';
    els.screenSourceText.textContent = 'No screen connected';
    els.explainScreenButton.disabled = true;
    els.clearScreenButton.textContent = 'Clear';
    els.screenshotInput.value = '';
  }

  async function startScreenShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showToast('Screen sharing is not available in this browser. Try uploading a screenshot instead.');
      return;
    }
    try {
      stopScreenShare();
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false });
      screenStream = stream;
      currentScreenMode = 'live';
      currentImageDataUrl = null;
      els.emptyScreen.hidden = true;
      els.uploadedImage.hidden = true;
      els.demoScreen.hidden = true;
      els.screenVideo.hidden = false;
      els.screenStage.classList.add('has-image');
      els.screenVideo.srcObject = stream;
      await els.screenVideo.play();
      els.screenModeLabel.textContent = 'Live screen share';
      els.screenSourceText.textContent = 'Screen shared · capture a frame to explain';
      els.explainScreenButton.disabled = false;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (currentScreenMode === 'live') {
          stopScreenShare();
          currentScreenMode = 'empty';
          els.screenVideo.hidden = true;
          els.emptyScreen.hidden = false;
          els.screenStage.classList.remove('has-image');
          els.screenModeLabel.textContent = 'Screen preview';
          els.screenSourceText.textContent = 'Screen sharing stopped';
          els.explainScreenButton.disabled = true;
        }
      });
    } catch (error) {
      if (error.name !== 'NotAllowedError') showToast(error.message || 'Could not share that screen.');
    }
  }

  function canvasDataUrl(source, maxDimension = 1600, quality = 0.82) {
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;
    if (!width || !height) throw new Error('The screen frame is not ready yet.');
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function imageFileToDataUrl(file) {
    if (!file.type.startsWith('image/')) throw new Error('Please select an image file.');
    if (file.size > 15 * 1024 * 1024) throw new Error('That image is over 15 MB. Please choose a smaller screenshot.');
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Could not open that image.'));
        image.src = objectUrl;
      });
      return canvasDataUrl(image, 1600, 0.82);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function getCurrentImage() {
    if (currentScreenMode === 'upload') return currentImageDataUrl;
    if (currentScreenMode === 'live') {
      if (!els.screenVideo.videoWidth) throw new Error('Wait for the shared screen to appear, then try again.');
      return canvasDataUrl(els.screenVideo, 1600, 0.82);
    }
    return null;
  }

  function addChatBubble(text, who = 'assistant') {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${who}`;
    bubble.textContent = text;
    els.chatHistory.appendChild(bubble);
  }

  function speakText(text) {
    if (!('speechSynthesis' in window)) {
      showToast('Read-aloud is not supported in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const lang = els.languageSelect.value;
    utterance.lang = lang === 'Hindi' ? 'hi-IN' : lang === 'Bengali' ? 'bn-IN' : 'en-IN';
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  }

  function renderAnalysis(data) {
    const title = data.screen_title || 'Your screen guide';
    const summary = data.screen_summary || 'I have looked at the information you shared.';
    const nextAction = data.next_action || 'Tell me what you would like to do next.';
    const steps = Array.isArray(data.steps) ? data.steps.slice(0, 4) : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const follow = data.follow_up || '';
    const spoken = [title, summary, 'Next action: ' + nextAction, ...steps.map((step, i) => `${i + 1}. ${step.title}. ${step.instruction}`), ...warnings].join('. ');
    lastSpeechText = spoken;

    let html = `<h3 class="result-title">${escapeHtml(title)}</h3><p class="result-summary">${escapeHtml(summary)}</p>`;
    html += `<div class="next-action-box"><div class="next-action-label">YOUR NEXT MOVE</div><div class="next-action-text">${escapeHtml(nextAction)}</div></div>`;
    if (steps.length) {
      html += '<div class="step-list">' + steps.map((step, index) => {
        const risk = String(step.risk || 'low').toLowerCase();
        return `<div class="step-card"><div class="step-card-head"><span class="step-number">${index + 1}</span><span>${escapeHtml(step.title || 'Step ' + (index + 1))}</span></div><p class="step-instruction">${escapeHtml(step.instruction || '')}</p>${step.target ? `<span class="target-tag">Look for: ${escapeHtml(step.target)}</span>` : ''}${step.why ? `<p class="step-why">Why: ${escapeHtml(step.why)}</p>` : ''}${risk === 'high' || risk === 'medium' ? `<p class="step-why">${risk === 'high' ? 'Important safety check' : 'Take a moment to verify this step.'}</p>` : ''}</div>`;
      }).join('') + '</div>';
    }
    if (warnings.length) html += warnings.map(warning => `<div class="warning-box">⚠ ${escapeHtml(warning)}</div>`).join('');
    if (follow) html += `<p class="follow-up-text">✦ ${escapeHtml(follow)}</p>`;
    html += '<button type="button" class="text-button read-aloud-button" id="readAloudButton">▶ Read these instructions aloud</button>';
    els.analysisResult.innerHTML = html;
    els.analysisResult.hidden = false;
    els.welcomeMessage.hidden = true;
    els.replyRow.hidden = false;
    setResponseState('GUIDE READY');
    $('#readAloudButton')?.addEventListener('click', () => speakText(lastSpeechText));
  }

  async function callAssistant({ goal, extraContext = '' }) {
    if (apiBusy) return;
    if (!aiReady) {
      showToast('Live AI is not connected. Use the guided ticket demo, or add an API key to enable screen understanding.');
      return;
    }
    apiBusy = true;
    els.guideButton.disabled = true;
    els.explainScreenButton.disabled = true;
    setResponseState('THINKING…', true);
    els.screenOverlay.hidden = false;
    els.overlayText.textContent = 'SAATHI is looking at your screen…';
    try {
      const imageDataUrl = await getCurrentImage();
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, goal, language: els.languageSelect.value, extraContext })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not analyze this screen.');
      renderAnalysis(data.result || {});
    } catch (error) {
      setResponseState('NEEDS A RETRY');
      showToast(error.message || 'Something went wrong. Please try again.');
    } finally {
      apiBusy = false;
      els.guideButton.disabled = false;
      els.explainScreenButton.disabled = currentScreenMode === 'empty';
      els.screenOverlay.hidden = true;
    }
  }

  function showDemoGuidance() {
    const data = demoGuidance[demoStage];
    renderAnalysis({
      screen_title: data.title,
      screen_summary: data.summary,
      next_action: data.action,
      steps: data.steps.map(([title, instruction, target]) => ({ title, instruction, target, risk: 'low' })),
      warnings: demoStage >= 2 ? ['Practice only: use sample details. No real booking or payment takes place.'] : [],
      follow_up: data.follow
    });
    setResponseState('PRACTICE GUIDE');
    highlightDemoTarget();
  }

  function highlightDemoTarget() {
    window.setTimeout(() => {
      els.demoScreen.querySelectorAll('.demo-highlight').forEach(node => node.classList.remove('demo-highlight'));
      const targetMap = { 0: '[data-highlight="from"]', 1: '[data-highlight="select-train"]', 2: '[data-highlight="passenger"]', 3: '[data-highlight="review"]', 4: '[data-highlight="complete"]' };
      const target = els.demoScreen.querySelector(targetMap[demoStage]);
      target?.classList.add('demo-highlight');
    }, 40);
  }

  function renderDemoScreen() {
    const header = `<div class="demo-app-window"><div class="demo-app-nav"><span>RAIL CONNECT <small>· Practice portal</small></span><span>Help&nbsp; ☰</span></div><div class="demo-app-content">`;
    let content = '';
    if (demoStage === 0) {
      content = `<h3>Plan your journey</h3><p>Practice booking · No real ticket will be issued</p><div class="demo-step-label">SEARCH TRAINS</div><div class="demo-form-grid"><label class="demo-field">From<input data-highlight="from" id="demoFrom" value="Kolkata" autocomplete="off"></label><label class="demo-field">To<input id="demoTo" value="New Delhi" autocomplete="off"></label><label class="demo-field">Journey date<input type="date" id="demoDate" value="2026-11-10"></label><label class="demo-field">Class<select id="demoClass"><option>AC 3 Tier</option><option>Sleeper</option><option>AC 2 Tier</option></select></label></div><button class="demo-app-button" data-demo-action="search">Search trains →</button>`;
    } else if (demoStage === 1) {
      content = `<h3>Available trains</h3><p>Sample results for Kolkata → New Delhi · 10 Nov 2026</p><div class="demo-step-label">CHOOSE ONE OPTION</div><div class="demo-train-card"><div><strong>Rajdhani Express · 12301</strong><span>16:50 Howrah → 10:00 New Delhi</span><br><span>17h 10m · AC 3 Tier</span></div><div style="text-align:right"><span class="demo-fare">₹1,850*</span><br><button class="demo-select" data-highlight="select-train" data-demo-action="select">Select</button></div></div><div class="demo-train-card"><div><strong>Duronto Express · 12259</strong><span>05:45 Howrah → 22:40 New Delhi</span><br><span>16h 55m · AC 3 Tier</span></div><div style="text-align:right"><span class="demo-fare">₹1,720*</span><br><button class="demo-select" data-demo-action="select">Select</button></div></div><p style="font-size:8px;color:#9aa5b4;margin-top:10px">*Invented sample fares for this demo. Not live availability.</p>`;
    } else if (demoStage === 2) {
      content = `<h3>Passenger details</h3><p>Enter sample information to practise the form.</p><div class="demo-form-grid"><label class="demo-field full">Passenger name<input data-highlight="passenger" id="demoName" value="Aarav Sharma" autocomplete="off"></label><label class="demo-field">Age<input id="demoAge" value="45" type="number" min="1" max="120"></label><label class="demo-field">Gender<select id="demoGender"><option>Male</option><option>Female</option><option>Other</option></select></label></div><button class="demo-app-button" data-demo-action="passenger">Continue →</button>`;
    } else if (demoStage === 3) {
      content = `<h3>Review your booking</h3><p>Check the details before completing the practice.</p><div data-highlight="review" style="border:1px solid #e5eaf0;border-radius:7px;padding:11px;font-size:10px;line-height:1.8;color:#66758a"><strong style="color:#1d385d">Kolkata → New Delhi</strong><br>10 November 2026 · AC 3 Tier<br>Sample passenger: ${escapeHtml($('#demoName')?.value || 'Aarav Sharma')}<br>Train: Rajdhani Express<br><strong style="color:#2c6848">Demo total: ₹1,850</strong></div><button class="demo-app-button" data-highlight="complete" data-demo-action="complete">Complete practice booking</button><button class="demo-app-button secondary" data-demo-action="back">Go back</button>`;
    } else {
      content = `<div class="demo-status" style="text-align:center;padding:20px 12px"><div style="font-size:26px;margin-bottom:8px">✓</div><strong>Practice booking complete!</strong><br>You have successfully completed the sample journey. No real ticket was booked and no payment was made.</div><button class="demo-app-button" data-demo-action="restart">Try again</button>`;
    }
    els.demoScreen.innerHTML = header + content + '</div></div>';
  }

  function startTicketDemo() {
    stopScreenShare();
    currentScreenMode = 'demo';
    currentImageDataUrl = null;
    demoStage = 0;
    els.emptyScreen.hidden = true;
    els.screenVideo.hidden = true;
    els.uploadedImage.hidden = true;
    els.demoScreen.hidden = false;
    els.screenStage.classList.remove('has-image');
    els.screenModeLabel.textContent = 'Guided practice · Train ticket';
    els.screenSourceText.textContent = 'Safe practice screen · Sample data only';
    els.explainScreenButton.disabled = false;
    els.goalInput.value = 'Help me understand how to book a train ticket';
    renderDemoScreen();
    showDemoGuidance();
  }

  function handleDemoAction(action) {
    if (action === 'search') {
      const from = $('#demoFrom')?.value.trim();
      const to = $('#demoTo')?.value.trim();
      if (!from || !to) { showToast('Please enter both the starting station and destination.'); return; }
      demoStage = 1;
    } else if (action === 'select') {
      demoStage = 2;
    } else if (action === 'passenger') {
      const name = $('#demoName')?.value.trim();
      const age = Number($('#demoAge')?.value);
      if (!name || !age || age < 1 || age > 120) { showToast('Please enter a sample name and a valid age.'); return; }
      demoStage = 3;
    } else if (action === 'complete') {
      demoStage = 4;
    } else if (action === 'back') {
      demoStage = 2;
    } else if (action === 'restart') {
      demoStage = 0;
    }
    renderDemoScreen();
    showDemoGuidance();
  }

  function submitGoal() {
    const goal = els.goalInput.value.trim() || 'Explain this screen and tell me the next useful action.';
    if (currentScreenMode === 'demo') {
      showDemoGuidance();
      showToast('You are in the safe practice flow. Use the sample app on the left.');
      return;
    }
    if (!aiReady) {
      showToast('Add an API key to enable live AI. The guided train-ticket practice is ready to use.');
      return;
    }
    callAssistant({ goal });
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Voice typing is not supported here. Try Chrome or type your goal.');
      return;
    }
    if (recognition) {
      recognition.stop();
      recognition = null;
      els.micButton.classList.remove('listening');
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = els.languageSelect.value === 'Hindi' ? 'hi-IN' : els.languageSelect.value === 'Bengali' ? 'bn-IN' : 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      const spoken = event.results?.[0]?.[0]?.transcript || '';
      els.goalInput.value = [els.goalInput.value.trim(), spoken].filter(Boolean).join(' ');
    };
    recognition.onerror = event => showToast(event.error === 'not-allowed' ? 'Please allow microphone access to use voice typing.' : 'Could not hear that clearly. Please try again.');
    recognition.onend = () => {
      recognition = null;
      els.micButton.classList.remove('listening');
    };
    els.micButton.classList.add('listening');
    recognition.start();
  }

  els.shareScreenButton.addEventListener('click', startScreenShare);
  els.screenshotInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      stopScreenShare();
      currentImageDataUrl = await imageFileToDataUrl(file);
      currentScreenMode = 'upload';
      els.emptyScreen.hidden = true;
      els.screenVideo.hidden = true;
      els.demoScreen.hidden = true;
      els.uploadedImage.hidden = false;
      els.uploadedImage.src = currentImageDataUrl;
      els.screenStage.classList.add('has-image');
      els.screenModeLabel.textContent = 'Uploaded screenshot';
      els.screenSourceText.textContent = `Screenshot ready · ${file.name}`;
      els.explainScreenButton.disabled = false;
    } catch (error) {
      showToast(error.message || 'Could not load that screenshot.');
    }
  });
  els.clearScreenButton.addEventListener('click', resetScreen);
  els.explainScreenButton.addEventListener('click', () => {
    if (currentScreenMode === 'demo') showDemoGuidance();
    else callAssistant({ goal: els.goalInput.value.trim() || 'Explain this screen and tell me the next useful action.' });
  });
  els.startDemoButton.addEventListener('click', startTicketDemo);
  els.guideButton.addEventListener('click', submitGoal);
  els.goalInput.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitGoal();
  });
  document.querySelectorAll('.prompt-chip').forEach(button => {
    button.addEventListener('click', () => {
      els.goalInput.value = button.dataset.goal || '';
      if (/book a train ticket/i.test(els.goalInput.value) && !aiReady) startTicketDemo();
      else if (currentScreenMode === 'demo') showDemoGuidance();
      else els.goalInput.focus();
    });
  });
  els.demoScreen.addEventListener('click', event => {
    const button = event.target.closest('[data-demo-action]');
    if (button) handleDemoAction(button.dataset.demoAction);
  });
  els.replyButton.addEventListener('click', () => {
    const message = els.replyInput.value.trim();
    if (!message) return;
    addChatBubble(message, 'user');
    els.replyInput.value = '';
    if (currentScreenMode === 'demo') {
      if (/done|finished|next|continue|selected|clicked|pressed/i.test(message)) {
        showToast('Use the highlighted control in the practice screen to move forward.');
      } else {
        addChatBubble('I can see where we are in this practice journey. Follow the highlighted control on the left, and I will explain the next stage.');
      }
      return;
    }
    callAssistant({ goal: els.goalInput.value.trim() || 'Help me with this screen.', extraContext: message });
  });
  els.replyInput.addEventListener('keydown', event => { if (event.key === 'Enter') els.replyButton.click(); });
  els.micButton.addEventListener('click', startVoiceInput);

  $('#helpButton').addEventListener('click', () => { els.helpModal.hidden = false; });
  $('#closeHelpButton').addEventListener('click', () => { els.helpModal.hidden = true; });
  $('#doneHelpButton').addEventListener('click', () => { els.helpModal.hidden = true; });
  els.helpModal.addEventListener('click', event => { if (event.target === els.helpModal) els.helpModal.hidden = true; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') els.helpModal.hidden = true; });
  window.addEventListener('beforeunload', stopScreenShare);

  checkStatus();
})();
