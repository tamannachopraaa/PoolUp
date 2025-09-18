// This script will run on the chat.ejs page to handle real-time messaging.
document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const chatBox = document.getElementById('chat-box');

    // Establish WebSocket connection
    const ws = new WebSocket('ws://localhost:3000'); // Use wss for production

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
    };

    ws.onmessage = (event) => {
        // Append new messages to the chat box
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.textContent = event.data;
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to the bottom
    };

    ws.onclose = () => {
        console.log('Disconnected from WebSocket server');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    // Handle form submission to send messages
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (message && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
            messageInput.value = ''; // Clear the input field
        }
    });
});