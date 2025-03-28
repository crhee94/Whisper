import { useNavigate } from 'react-router-dom';
import {
	NEW_EVENT_CHAT_RESTORE,
	NEW_EVENT_CLOSED,
	NEW_EVENT_INACTIVE,
	NEW_EVENT_JOIN,
	NEW_EVENT_JOINED,
} from '../../../constants.json';
import { connectWithId, socket } from 'src/lib/socketConnection';
import { useCallback, useEffect, useRef, useState } from 'react';

import Anonymous from 'components/Anonymous';
import { createBrowserNotification } from 'src/lib/browserNotification';
import { isExplicitDisconnection } from 'src/lib/utils';
import { useApp } from 'src/context/AppContext';
import { useAuth } from 'src/context/AuthContext';
import { useChat } from 'src/context/ChatContext';
import useCloseChat from 'src/hooks/useCloseChat';
import { useNotification } from 'src/lib/notification';
import ReconnectBanner from './ReconnectBanner';

const defaultLoadingText = <p>Looking for a random buddy</p>;

const BuddyMatcher = () => {
	const { playNotification } = useNotification();
	const navigate = useNavigate();
	const { authState } = useAuth();
	const { createChat, closeChat, closeAllChats } = useChat();
	const { startSearch, endSearch, app } = useApp();
	const { setLoadingText, startNewSearch } = useCloseChat();

	const [disconnected, setDisconnected] = useState(false);
	const reconnectAttempts = useRef(0);

	function disconnect() {
		reconnectAttempts.current = 0;
		if (app.currentChatId) {
			return;
		}

		socket.disconnect();
		setDisconnected(true);
		endSearch();
	}

	async function handleReconnect() {
		if (socket.connected) {
			return;
		}

		startSearch();
		setLoadingText(defaultLoadingText);
		await connectWithId(app.currentChatId);
	}

	const onUserJoined = useCallback(({ roomId, userIds }) => {
		playNotification('buddyPaired');
		createBrowserNotification(
			"Let's Chat :)",
			"You've found a match, don't keep your Partner waiting ⌛"
		);
		createChat(roomId, userIds);
		endSearch(roomId);
	}, []);

	const onRestoreChat = useCallback(({ chats, currentChatId }) => {
		Object.values(chats).forEach((chat) => {
			createChat(chat.id, chat.userIds, chat.messages, chat.createdAt);
		});
		endSearch(currentChatId);
	}, []);

	const onConnect = useCallback(() => {
		// Here server will be informed that user is searching for
		// another user
		socket.emit(NEW_EVENT_JOIN, {
			loginId: authState.loginId,
			email: authState.email,
		});
		setDisconnected(false);
	}, []);

	const onClose = useCallback((chatId) => {
		endSearch();
		closeChat(chatId);
		playNotification('chatClosed');

		if (!confirm('This chat is closed! Would you like to search for a new buddy?')) {
			navigate('/');
			return;
		}

		createBrowserNotification('Chat Closed', 'Your buddy left the chat');
		startNewSearch();
	}, []);

	const onInactive = useCallback(() => {
		closeAllChats();
	}, []);

	const onDisconnect = useCallback((reason) => {
		if (isExplicitDisconnection(reason)) {
			return;
		}

		disconnect();
	}, []);

	const onReconnectAttempt = useCallback((attempts) => {
		reconnectAttempts.current = attempts;
	}, []);

	const onReconnectError = useCallback(() => {
		if (reconnectAttempts.current >= 3) {
			disconnect();
		}
	}, []);

	useEffect(() => {
		const setupSocket = async () => {
			if (!app.currentChatId) {
				startSearch();
			}

			if (!socket.connected) {
				try {
					await connectWithId(app.currentChatId);
				} catch (error) {
					console.error('Failed to connect:', error);
				}
			}
		};

		setupSocket();

		socket.on('connect', onConnect);
		socket.on(NEW_EVENT_CLOSED, onClose);
		socket.on(NEW_EVENT_JOINED, onUserJoined);
		socket.on(NEW_EVENT_CHAT_RESTORE, onRestoreChat);
		socket.on(NEW_EVENT_INACTIVE, onInactive);
		socket.on('disconnect', onDisconnect);
		socket.io.on('reconnect_attempt', onReconnectAttempt);
		socket.io.on('reconnect_error', onReconnectError);

		return () => {
			socket
				.off('connect', onConnect)
				.off(NEW_EVENT_JOINED, onUserJoined)
				.off(NEW_EVENT_CHAT_RESTORE, onRestoreChat)
				.off(NEW_EVENT_CLOSED, onClose)
				.off(NEW_EVENT_INACTIVE, onInactive)
				.off('disconnect', onDisconnect);

			socket.io
				.off('reconnect_attempt', onReconnectAttempt)
				.off('reconnect_error', onReconnectError);

			socket.disconnect();
		};
	}, [app.currentChatId]);

	if (app.isSearching || !app.currentChatId) {
		navigate('/searching');
	}

	return disconnected ? <ReconnectBanner handleReconnect={handleReconnect} /> : <Anonymous />;
};

export default BuddyMatcher;
