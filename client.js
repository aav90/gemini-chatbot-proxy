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

    // --- Utility Functions ---

    // Function to scroll chat messages to the bottom
    function scrollToBottom() {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // Function to add a message bubble to the chat interface
    function addMessage(text, type, audioBlob = null) {
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', `${type}-message`);
        if (type === 'bot') {
            messageBubble.innerHTML = text; // Use innerHTML for formatted paragraphs
            if (audioBlob) {
                const audioPlayer = document.createElement('audio');
                audioPlayer.controls = true;
                audioPlayer.src = URL.createObjectURL(audioBlob);
                messageBubble.appendChild(audioPlayer);
            }
        } else {
            messageBubble.textContent = text;
        }
        messagesDiv.appendChild(messageBubble);
        scrollToBottom();
    }

    // Function to enable/disable UI elements during processing
    function setUIState(enabled) {
        userInput.disabled = !enabled;
        sendButton.disabled = !enabled;
        voiceButton.disabled = !enabled;
        if (!enabled) {
            userInput.placeholder = "Processing...";
        } else {
            userInput.placeholder = "Type your message...";
        }
    }

    // --- Event Handlers ---

    // Send button click or Enter key press
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        addMessage(message, 'user');
        userInput.value = ''; // Clear input field
        setUIState(false); // Disable UI during processing

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            addMessage(data.reply, 'bot'); // Display formatted reply from server

        } catch (error) {
            console.error('Error sending message:', error);
            addMessage(`Error: ${error.message}. Please try again.`, 'bot');
        } finally {
            setUIState(true); // Re-enable UI
        }
    }

    // Voice button functionality
    voiceButton.addEventListener('click', async () => {
        if (!isRecording) {
            // Start recording
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                // Use 'audio/webm;codecs=opus' for compatibility with Google Speech-to-Text
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
                audioChunks = [];

                mediaRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    setUIState(false); // Disable UI while processing audio
                    recordingIndicator.style.display = 'none';

                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                    // Optionally, play back user's recorded audio (for testing)
                    // const userAudioUrl = URL.createObjectURL(audioBlob);
                    // addMessage(`User recorded audio: <audio controls src="${userAudioUrl}"></audio>`, 'user');

                    // Create a FormData object to send the audio file
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'recording.webm');
                    formData.append('language', languageSelect.value); // Append selected language

                    try {
                        const response = await fetch('/voice', {
                            method: 'POST',
                            body: formData
                        });

                        if (!response.ok) {
                            const errorData = await response.json();
                            throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
                        }

                        const data = await response.json();
                        const botAudioBlob = new Blob([
                            Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))
                        ], { type: 'audio/mp3' });
                        addMessage(data.reply, 'bot', botAudioBlob); // Display formatted reply and play audio

                    } catch (error) {
                        console.error('Error processing voice message:', error);
                        addMessage(`Error: ${error.message}. Please try again.`, 'bot');
                    } finally {
                        setUIState(true); // Re-enable UI
                    }
                    // Stop the audio stream tracks to release microphone
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                isRecording = true;
                voiceButton.textContent = 'Stop Recording';
                recordingIndicator.style.display = 'flex'; // Show recording indicator
                setUIState(false); // Disable other UI elements
                userInput.disabled = true; // Keep input disabled
                sendButton.disabled = true; // Keep send disabled
                voiceButton.disabled = false; // Keep voice button enabled to stop
                userInput.placeholder = "Recording...";

            } catch (err) {
                console.error('Error accessing microphone:', err);
                alert('Could not access microphone. Please ensure it is connected and permissions are granted.');
                setUIState(true); // Re-enable UI if microphone access fails
            }
        } else {
            // Stop recording
            mediaRecorder.stop();
            isRecording = false;
            voiceButton.textContent = 'Voice';
            recordingIndicator.style.display = 'none';
        }
    });

    // Initial state setup
    setUIState(true);
});
