const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const { YoutubeTranscript } = require('youtube-transcript');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const parser = new Parser();

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const CHANNEL_ID = 'UCtjRA-7EuBmyWMyty1HZAPQ';

app.get('/api/recent-videos', async (req, res) => {
    try {
        const feed = await parser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);

        // Filter videos from the past 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentVideos = feed.items.filter(item => {
            const pubDate = new Date(item.pubDate);
            return pubDate >= thirtyDaysAgo;
        }).map(item => ({
            id: item.id.replace('yt:video:', ''),
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
            author: item.author
        }));

        res.json({ success: true, videos: recentVideos });
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch videos from RSS feed.' });
    }
});

app.post('/api/summarize', async (req, res) => {
    const { videoId, title } = req.body;

    if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({
            success: false,
            error: 'GEMINI_API_KEYが設定されていません。.envファイルを確認してください。'
        });
    }

    try {
        // Fetch Transcript
        const transcriptList = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' }).catch(err => {
            console.log('Falling back to default language for transcript');
            return YoutubeTranscript.fetchTranscript(videoId);
        });

        if (!transcriptList || transcriptList.length === 0) {
            return res.status(404).json({ success: false, error: '字幕（トランスクリプト）が見つかりませんでした。' });
        }

        const fullText = transcriptList.map(t => t.text).join(' ');

        // Summarize using Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

        const prompt = `以下の文章は中島聡のYouTube動画「${title}」の字幕です。この動画の重要なポイントを抽出し、日本語で簡潔に（3〜5箇条書き程度で）要約してください。\n\n${fullText.substring(0, 15000)}`;

        const result = await model.generateContent(prompt);
        const summary = result.response.text();

        res.json({ success: true, summary });

    } catch (error) {
        console.error(`Error summarizing video ${videoId}:`, error);
        res.status(500).json({ success: false, error: error.message || '要約中にエラーが発生しました。' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
