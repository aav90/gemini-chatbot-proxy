document.addEventListener('DOMContentLoaded', () => {
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const voiceButton = document.getElementById('voice-button');
  const messagesDiv = document.getElementById('messages');
  const recordingIndicator = document.getElementById('recording-indicator');
  const languageSelect = document.getElementById('language-select');

  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;

  function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function addMessage(text, type, audioBlob = null) {
    const bubble = document.createElement('div');
    bubble.classList.add('message-bubble', `${type}-message`);
    bubble.innerHTML = text;
    if (audioBlob) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = URL.createObjectURL(audioBlob);
      bubble.appendChild(audio);
    }
    messagesDiv.appendChild(bubble);
    scrollToBottom();
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.classList.add('bot-message', 'message-bubble');
    typing.id = "typing-indicator";
    typing.innerHTML = "<em>Assistant is typing...</em>";
    messagesDiv.appendChild(typing);
    scrollToBottom();
  }

  function hideTyping() {
    const typing = document.getElementById("typing-indicator");
    if (typing) typing.remove();
  }

  function setUIState(enabled) {
    userInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    voiceButton.disabled = !enabled;
    userInput.placeholder = enabled ? "Type your message..." : "Processing...";
  }

  async function sendMessage() {
    const message = userInput.value.trim();
    if (!message) return;

    addMessage(message, 'user');
    userInput.value = '';
    setUIState(false);
    showTyping();

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: "include",
        body: JSON.stringify({ message })
      });

      // بررسی می‌کنیم اگر سرور استریم می‌کنه
      if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n\n").filter(Boolean);
          lines.forEach(line => {
            if (line.startsWith("data:")) {
              const data = JSON.parse(line.replace(/^data:\s*/, ""));
              fullText += data.text;
              hideTyping();
              addMessage(data.text, 'bot');
            }
          });
        }
      } else {
        const data = await response.json();
        hideTyping();
        addMessage(data.reply, 'bot');
      }

    } catch (err) {
      console.error(err);
      hideTyping();
      addMessage("❌ Error talking to server.", 'bot');
    } finally {
      setUIState(true);
    }
  }

  sendButton.addEventListener('click', sendMessage);
  userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  voiceButton.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

        mediaRecorder.onstop = async () => {
          setUIState(false);
          recordingIndicator.style.display = 'none';
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
          addMessage(`<em>You sent a voice message</em>`, 'user', audioBlob);

          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');
          formData.append('language', languageSelect.value);

          showTyping();
          try {
            const resp = await fetch('/voice', { method: 'POST', body: formData, credentials: "include" });
            const data = await resp.json();

            hideTyping();

            if (data.audio) {
              const botAudioBlob = new Blob([Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))], { type: 'audio/mp3' });
              addMessage(data.reply, 'bot', botAudioBlob);
            } else {
              addMessage(data.reply, 'bot');
            }

          } catch (err) {
            console.error(err);
            hideTyping();
            addMessage("❌ Voice error.", 'bot');
          } finally {
            setUIState(true);
          }

          stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        voiceButton.textContent = 'Stop';
        recordingIndicator.style.display = 'flex';
      } catch (err) {
        console.error(err);
        alert('Mic access denied.');
      }
    } else {
      mediaRecorder.stop();
      isRecording = false;
      voiceButton.textContent = 'Voice';
      recordingIndicator.style.display = 'none';
    }
  });

  setUIState(true);
});
