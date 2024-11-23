const { Pool } = require('pg');
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = 3000;

// PostgreSQL connection pool
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'voting_app',
    password: '123456',
    port: 5432,
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
}));
app.use(express.static(__dirname)); // Serve static files

// Routes for Static Pages
app.get('/about', (req, res) => {
    res.sendFile(__dirname + '/about.html');
});

app.get('/contact', (req, res) => {
    res.sendFile(__dirname + '/contact.html');
});

// Voting Page: Protect access
app.get('/vote', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login.html'); // Redirect to login if not logged in
    }

    try {
        const pollsResult = await pool.query('SELECT * FROM polls');
        const polls = pollsResult.rows;

        const pollOptionsResult = await pool.query('SELECT * FROM poll_options');
        const pollOptions = pollOptionsResult.rows;

        const formattedPolls = polls.map(poll => {
            return {
                id: poll.id,
                title: poll.title,
                options: pollOptions.filter(option => option.poll_id === poll.id).map(option => option.option_text),
            };
        });

        res.json({ polls: formattedPolls });
    } catch (err) {
        console.error('Error fetching polls:', err);
        res.status(500).json({ success: false, message: 'Error fetching polls.' });
    }
});

// Registration Endpoint
app.post('/register', async (req, res) => {
    const { email, password, is_admin = false } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (email, password, is_admin) VALUES ($1, $2, $3)', [email, hashedPassword, is_admin]);
        res.status(201).send({ message: 'User registered successfully!' });
    } catch (err) {
        res.status(400).send(err.message);
    }
});

// Login Endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(400).json({ success: false, message: 'Invalid password' });
        }

        req.session.user = {
            id: user.id,
            email: user.email,
            is_admin: user.is_admin,
        };

        res.json({ success: true, is_admin: user.is_admin });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Endpoint to get all polls for the admin dashboard
app.get('/get-polls', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const pollsResult = await pool.query('SELECT * FROM polls');
        const pollOptionsResult = await pool.query('SELECT * FROM poll_options');

        const polls = pollsResult.rows.map(poll => ({
            id: poll.id,
            title: poll.title,
            options: pollOptionsResult.rows
                .filter(option => option.poll_id === poll.id)
                .map(option => option.option_text),
        }));

        res.json({ success: true, polls });
    } catch (err) {
        console.error('Error fetching polls:', err);
        res.status(500).json({ success: false, message: 'Error fetching polls.' });
    }
});

// Endpoint to check admin status
app.get('/is-admin', (req, res) => {
    if (!req.session.user) {
        return res.json({ isAdmin: false });
    }
    res.json({ isAdmin: req.session.user.is_admin });
});

// Endpoint to delete a poll
app.delete('/delete-poll/:pollId', async (req, res) => {
    const { pollId } = req.params;

    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        await pool.query('DELETE FROM poll_options WHERE poll_id = $1', [pollId]);
        await pool.query('DELETE FROM polls WHERE id = $1', [pollId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting poll:', err);
        res.status(500).json({ success: false, message: 'Error deleting poll.' });
    }
});


// Logout Endpoint
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/'); // Redirect to home page
});

// Admin Dashboard Route: Fetch Polls
app.get('/admin-dashboard', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Access denied. Admins only.');
    }

    try {
        const pollsResult = await pool.query('SELECT * FROM polls');
        const polls = pollsResult.rows;

        const pollOptionsResult = await pool.query('SELECT * FROM poll_options');
        const pollOptions = pollOptionsResult.rows;

        const formattedPolls = polls.map(poll => {
            return {
                id: poll.id,
                title: poll.title,
                options: pollOptions.filter(option => option.poll_id === poll.id).map(option => option.option_text),
            };
        });

        // Render polls on admin dashboard
        res.json({ polls: formattedPolls });
    } catch (err) {
        console.error('Error fetching polls for admin:', err);
        res.status(500).json({ success: false, message: 'Error fetching polls for admin.' });
    }
});

// Endpoint to create a new poll (admin only)
app.post('/create-poll', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Access denied. Admins only.');
    }

    const { title, options } = req.body;

    try {
        const pollResult = await pool.query('INSERT INTO polls (title) VALUES ($1) RETURNING id', [title]);
        const pollId = pollResult.rows[0].id;

        // Insert poll options into the 'poll_options' table
        for (const option of options) {
            await pool.query('INSERT INTO poll_options (poll_id, option_text) VALUES ($1, $2)', [pollId, option]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error creating poll:', err);
        res.status(500).json({ success: false, message: 'Error creating poll.' });
    }
});

// Endpoint to record a vote
app.post('/vote/:pollId', async (req, res) => {
    const { pollId } = req.params;
    const { userId, selectedOption } = req.body;  // Extract userId and selectedOption from the request body

    console.log('Request received:', { pollId, userId, selectedOption }); // Debugging log

    if (!userId || !selectedOption) {
        return res.status(400).json({
            success: false,
            message: 'Missing userId or selectedOption.',
        });
    }

    try {
        // Check if the user has already voted for this poll
        const existingVote = await pool.query(
            'SELECT * FROM votes WHERE poll_id = $1 AND user_id = $2',
            [pollId, userId]
        );

        if (existingVote.rows.length > 0) {
            // If the user has already voted, return an error
            return res.status(400).json({
                success: false,
                message: 'You have already voted in this poll.',
            });
        }

        // Validate if the selected option exists for this poll
        const pollOptionResult = await pool.query(
            'SELECT * FROM poll_options WHERE poll_id = $1 AND option_text = $2',
            [pollId, selectedOption]
        );

        if (pollOptionResult.rows.length === 0) {
            // If the selected option is invalid, return an error
            return res.status(400).json({
                success: false,
                message: 'Invalid option selected.',
            });
        }

        // Insert the vote into the database
        await pool.query(
            'INSERT INTO votes (poll_id, user_id, option_id) VALUES ($1, $2, $3)',
            [pollId, userId, pollOptionResult.rows[0].id]  // Use the option_id for inserting the vote
        );

        // Return success response
        res.json({
            success: true,
            message: 'Vote recorded successfully!',
        });
    } catch (err) {
        console.error('Error recording vote:', err);
        res.status(500).json({
            success: false,
            message: 'Error recording vote. Please try again.',
        });
    }
});





// Root Route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
