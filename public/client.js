document.addEventListener('DOMContentLoaded', () => {
    const chatLog = document.getElementById('chat-log');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const voiceButton = document.getElementById('voice-button');
    const loadingIndicator = document.getElementById('loading-indicator');
    const recordingStatus = document.getElementById('recording-status');

    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;

    // --- Utility Functions ---

    // Function to scroll chat messages to the bottom
    function scrollToBottom() {
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    // Function to add a message bubble to the chat interface
    // Now accepts HTML content for bot messages
    function addMessage(sender, content, audioBlob = null) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message-bubble');
        messageDiv.classList.add(sender === 'user' ? 'user-message' : 'learniamo-message');

        if (sender === 'learniamo') {
            messageDiv.innerHTML = content; // Insert HTML directly for formatted text
            if (audioBlob) {
                const audioPlayer = document.createElement('audio');
                audioPlayer.controls = true;
                audioPlayer.src = URL.createObjectURL(audioBlob);
                audioPlayer.onended = () => {
                    // Optional: Clean up URL object after playback
                    URL.revokeObjectURL(audioPlayer.src);
                };
                messageDiv.appendChild(audioPlayer);
                audioPlayer.play().catch(e => console.error("Audio playback error:", e));
            }
        } else {
            messageDiv.textContent = content; // For user messages, just text
        }

        chatLog.appendChild(messageDiv);
        scrollToBottom();
    }

    // Function to enable/disable UI elements during processing
    function setUIState(enabled) {
        messageInput.disabled = !enabled;
        sendButton.disabled = !enabled;
        voiceButton.disabled = !enabled;
        if (enabled) {
            messageInput.placeholder = "Ask LEARNIAMO anything...";
        } else {
            messageInput.placeholder = "Processing...";
        }
    }

    // --- Event Handlers ---

    // Send button click or Enter key press for text messages
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    async function sendMessage() {
        const userMessage = messageInput.value.trim();
        if (!userMessage) return;

        addMessage('user', userMessage);
        messageInput.value = ''; // Clear input field
        setUIState(false); // Disable UI during processing
        loadingIndicator.style.display = 'block'; // Show loading indicator

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            addMessage('learniamo', data.reply); // Display formatted reply from server

        } catch (error) {
            console.error('Error sending message:', error);
            addMessage('learniamo', `Error: ${error.message}. Please try again.`);
        } finally {
            setUIState(true); // Re-enable UI
            loadingIndicator.style.display = 'none'; // Hide loading indicator
            messageInput.focus(); // Focus input for next message
        }
    }

    // Voice button functionality
    voiceButton.addEventListener('click', async () => {
        if (!isRecording) {
            // Start recording
            try {
                // Request microphone access
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                // Use 'audio/webm;codecs=opus' for compatibility with Google Speech-to-Text
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
                audioChunks = [];

                mediaRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    setUIState(false); // Disable UI while processing audio
                    recordingStatus.style.display = 'none'; // Hide recording indicator

                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });

                    // Create a FormData object to send the audio file
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'recording.webm');
                    // No language select in this version, default to server's language

                    loadingIndicator.style.display = 'block'; // Show loading indicator

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
                        // Convert base64 audio to Blob
                        const botAudioBlob = new Blob([
                            Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))
                        ], { type: 'audio/mp3' });
                        addMessage('learniamo', data.reply, botAudioBlob); // Display formatted reply and play audio

                    } catch (error) {
                        console.error('Error processing voice message:', error);
                        addMessage('learniamo', `Error: ${error.message}. Please try again.`);
                    } finally {
                        setUIState(true); // Re-enable UI
                        loadingIndicator.style.display = 'none'; // Hide loading indicator
                        messageInput.focus(); // Focus input
                    }
                    // Stop the audio stream tracks to release microphone
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                isRecording = true;
                voiceButton.textContent = 'Stop Recording';
                recordingStatus.style.display = 'block'; // Show recording indicator
                setUIState(false); // Disable other UI elements
                voiceButton.disabled = false; // Keep voice button enabled to stop
                messageInput.placeholder = "Recording...";

            } catch (err) {
                console.error('Error accessing microphone:', err);
                // Use addMessage for errors instead of alert for sandboxed environments
                addMessage('learniamo', 'Error: Could not access microphone. Please ensure it is connected and permissions are granted.');
                setUIState(true); // Re-enable UI if microphone access fails
            }
        } else {
            // Stop recording
            mediaRecorder.stop();
            isRecording = false;
            voiceButton.textContent = 'Voice';
            recordingStatus.style.display = 'none';
        }
    });

    // Initial state setup
    setUIState(true);
    messageInput.focus(); // Focus input on page load
});
