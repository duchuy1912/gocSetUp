const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Pool } = require('pg');
const cookieParser = require('cookie-parser')
const bcryptjs = require('bcryptjs');
const multer = require("multer");
const path = require("path");
const { ppid } = require('process');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static("public"));
app.use(cookieParser());

// Kết nối PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // ssl: { rejectUnauthorized: false }
});

// Cấu hình session
app.use(session({
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));
async function getFiveBestProducts() {
    try {
        const fiveBestProducts = await pool.query(`
            SELECT * from combos
        `);
        return fiveBestProducts.rows;
    } catch (err) {
        console.error("Lỗi truy vấn sản phẩm:", err);
        return [];
    }
}

// Khởi tạo Passport
app.use(passport.initialize());
app.use(passport.session());


passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser(async (user, done) => {
    try {
        let foundUser;
        if (user.google_id) {
            foundUser = await pool.query('SELECT * FROM users WHERE google_id = $1', [user.google_id]);
        } else {
            foundUser = await pool.query('SELECT * FROM users WHERE email = $1', [user.email]);
        }
        done(null, foundUser.rows[0] || false);
    } catch (err) {
        done(err, null);
    }
});

// Cấu hình Passport với Google OAuth2
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: 'http://localhost:3000/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const { id: googleId, displayName } = profile;
        const email = profile.emails?.[0]?.value || null;
        const avatar = profile.photos?.[0]?.value || null;

        let user = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);

        if (user.rows.length === 0) {
            const newUser = await pool.query(
                `INSERT INTO users (google_id, display_name, email, avatar, role) 
                VALUES ($1, $2, $3, $4, 'user') RETURNING *`,
                [googleId, displayName, email, avatar]
            );
            return done(null, newUser.rows[0]);
        }

        return done(null, user.rows[0]);
    } catch (err) {
        return done(err, null);
    }
}));



// Route đăng nhập với Google
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Xử lý callback từ Google

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/logout' }),
    async (req, res) => {
        try {
            const { category } = req.query;
            let productsQuery = 'SELECT * FROM products';
            let queryParams = [];

            if (category) {
                productsQuery += ' WHERE category_id = $1';
                queryParams.push(category);
            }

            const fiveBestProduct = await getFiveBestProducts();
            const products = await pool.query(productsQuery, queryParams);
            const categories = await pool.query('SELECT * FROM categories');
            // console.log(req.user)
            // console.log("Session Google")
            // console.log(req.session.passport.user);
            res.render('home.ejs', {
                user: req.user,
                fiveBestProduct: fiveBestProduct,
                products: products.rows,
                categories: categories.rows
            });

        } catch (error) {
            console.error("Lỗi khi lấy dữ liệu:", error);
            res.redirect('/logout');
        }
    }
);


// Đăng xuấtxuất
app.get("/logout", (req, res) => {
    req.logout(err => {
        if (err) return next(err);
        res.redirect("/");
    });
});


// Route chính
app.get('/', async (req, res) => {
    try {
        const { category } = req.query;
        let productsQuery = 'SELECT * FROM products';
        let queryParams = [];

        if (category) {
            productsQuery += ' WHERE category_id = $1';
            queryParams.push(category);
        }
        const fiveBestProduct = await getFiveBestProducts();
        const products = await pool.query(productsQuery, queryParams);
        const categories = await pool.query('SELECT * FROM categories');
        res.render('home.ejs', {
            user: req.isAuthenticated() ? req.user : null,
            fiveBestProduct: fiveBestProduct,
            categories: categories.rows,
            products: products.rows
        });
    } catch (err) {
        console.error("Lỗi khi lấy sản phẩm:", err);
        res.status(500).send("Lỗi server");
    }
});


// Đăng nhậpnhập
app.get('/login', (req, res) => {
    res.render("login.ejs")
})
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Kiểm tra email có tồn tại không
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (user.rows.length === 0) {
            return res.send('Email không tồn tại!');
        }
        // console.log("Đây là user ");
        // console.log(user.rows[0]);
        userKQ = user.rows[0];
        const isMatch = await bcryptjs.compare(password, user.rows[0].password);
        if (!isMatch) {
            return res.status(401).send("Mật khẩu không chính xác!");
        }

        // Lấy danh mục sản phẩm
        const categories = await pool.query('SELECT * FROM categories');

        // Lấy danh sách sản phẩm (toàn bộ hoặc theo danh mục nếu có)
        const { category } = req.query;
        let productsQuery = 'SELECT * FROM products';
        let queryParams = [];

        if (category) {
            productsQuery += ' WHERE category_id = $1';
            queryParams.push(category);
        }
        const fiveBestProduct = await getFiveBestProducts();
        const products = await pool.query(productsQuery, queryParams);
        req.login(user.rows[0], (err) => {
            if (err) {
                console.error(err);
                return next(err);
            }
            req.session.save((err) => {
                if (err) {
                    console.error("Lỗi khi lưu session:", err);
                    return res.status(500).send("Lỗi khi lưu session!");
                }
                // console.log("Đây là session TK MK")
                // console.log(req.session.passport.user);
                res.redirect('/');
            });
        });

    } catch (err) {
        console.error(err);
        res.send('Lỗi khi đăng nhập!');
    }
});

// Đăng ký 
app.get('/register', (req, res) => {
    res.render("register.ejs")
})
app.post('/register', async (req, res) => {
    const { full_name, email, password } = req.body;
    // console.log(full_name, email, password);

    try {
        // Kiểm tra email đã tồn tại chưa
        const checkUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (checkUser.rows.length > 0) {
            return res.send('Email đã tồn tại!');
        }

        // Đặt role là 'admin' nếu email là admin
        const role = (email === 'admin@example.com') ? 'admin' : 'user';
        const hashingPassword = await bcryptjs.hash(password, 10);

        // Lưu vào database
        await pool.query(
            'INSERT INTO users (display_name, email, password, role) VALUES ($1, $2, $3, $4)',
            [full_name, email, hashingPassword, role]
        );

        // Lấy thông tin người dùng vừa tạo
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        // Lấy danh mục sản phẩm
        const categories = await pool.query('SELECT * FROM categories');

        // Lấy danh sách sản phẩm (toàn bộ hoặc theo danh mục nếu có)
        const { category } = req.query;
        let productsQuery = 'SELECT * FROM products';
        let queryParams = [];

        if (category) {
            productsQuery += ' WHERE category_id = $1';
            queryParams.push(category);
        }
        const fiveBestProduct = await getFiveBestProducts();
        const products = await pool.query(productsQuery, queryParams);

        res.render("home.ejs", {
            user: user.rows[0],
            fiveBestProduct: fiveBestProduct,
            categories: categories.rows,
            products: products.rows
        });

    } catch (err) {
        console.error(err);
        res.send('Lỗi khi đăng ký!');
    }
});
//Sản Phẩm 
app.get('/product/:id', async (req, res) => {
    const productId = req.params.id;
    // console.log(req.message+"hello2");
    // if(req.message){
    //     console.log(req.message+"hello");
    // }
    try {
        // Lấy thông tin sản phẩm
        const productQuery = 'SELECT * FROM products WHERE id = $1';
        const productResult = await pool.query(productQuery, [productId]);
        // console.log(typeof productId);

        // Lấy danh sách ảnh sản phẩm
        const imagesQuery = 'SELECT image_url FROM product_images WHERE product_id = $1';
        const imagesResult = await pool.query(imagesQuery, [productId]);

        // Lấy thông tin chi tiết sản phẩm
        const detailsQuery = 'SELECT * FROM product_details WHERE product_id = $1';
        const detailsResult = await pool.query(detailsQuery, [productId]);

        if (productResult.rows.length === 0) {
            return res.status(404).send('Sản phẩm không tồn tại!');
        }
        // req.session.message = "Sản phẩm đã được thêm vào giỏ hàng!";
        res.render('product-detail.ejs', {
            user: req.isAuthenticated() ? req.user : null,
            product: productResult.rows[0],
            images: imagesResult.rows,
            details: detailsResult.rows[0] || {} // Nếu không có, trả về object rỗng
            // message:req.message
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Lỗi khi lấy dữ liệu sản phẩm!');
    }
});
// Combo 
app.get('/comboProducts/:id', async (req, res) => {
    const comboId = req.params.id;

    try {
        const comboQuery = `
            SELECT *
            FROM combos WHERE id = $1
        `;
        const combo = await pool.query(comboQuery, [comboId]);
        const productsQuery = `
            SELECT p.id, p.name, p.image, p.price, cp.quantity
            FROM combo_products cp
            JOIN products p ON cp.product_id = p.id
            WHERE cp.combo_id = $1
        `;
        const products = await pool.query(productsQuery, [comboId]);

        if (combo.length === 0) {
            return res.status(404).json({ message: "Combo không tồn tại!" });
        }

        res.render("combo-detail.ejs", {
            user: req.isAuthenticated() ? req.user : null,
            combo: combo.rows[0],
            products: products.rows
        })
    } catch (error) {
        console.error("Lỗi lấy combo:", error);
        res.status(500).json({ message: "Lỗi server!" });
    }
});
//Style của bạn là đéo gìgì
app.get('/whatIsStyle', (req, res) => {
    res.render("what-is-style.ejs", {
        user: req.isAuthenticated() ? req.user : null,
    })
})
//Tiềm KiếmKiếm
app.get("/searchBox", async (req, res) => {
    let querySearch = req.query.q || "";
    try {
        const fiveBestProduct = await getFiveBestProducts();
        const products = await pool.query('SELECT * FROM products WHERE name ILIKE $1', [`%${querySearch}%`]);
        const categories = await pool.query('SELECT * FROM categories');
        res.render('home.ejs', {
            user: req.isAuthenticated() ? req.user : null,
            fiveBestProduct: fiveBestProduct,
            categories: categories.rows,
            products: products.rows
        });
    } catch (err) {
        console.error("Lỗi khi Tìm sản phẩm:", err);
        res.status(500).send("Lỗi server");
    }

});
//Quản lýlý
app.get('/admin', (req, res) => {

    res.render("admin.ejs", {
        user: req.isAuthenticated() ? req.user : null
    });
});

//Thêm product 
app.get('/admin/add-product', async (req, res) => {
    const categories = await pool.query("select * from categories");
    res.render("admin-add-product.ejs", {
        categories: categories.rows
    })
})


// Cấu hình lưu trữ file ảnh
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/img/'); // Thư mục lưu ảnh
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname); // Lấy phần mở rộng (ví dụ: .jpg, .png)
        const filename = file.originalname.replace(/\s+/g, '-').toLowerCase(); // Chuyển tên file thành chữ thường, thay khoảng trắng bằng dấu "-"
        cb(null, Date.now() + '-' + filename); // Đổi tên file, tránh trùng lặp
    }
});

const upload = multer({ storage: storage });

app.post('/admin/add-product', upload.fields([{ name: "image" }, { name: "product_images" }]), async (req, res) => {
    try {
        const { name, description, price, category_id, stock, specifications, warranty, usage_instructions, additional_info } = req.body;
        const image = req.files["image"] ? req.files["image"][0].filename : null;

        // Thêm vào bảng products
        const productResult = await pool.query(`
            INSERT INTO products (name, description, price, image, category_id, stock) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [name, description, price, image, category_id, stock]);

        const productId = productResult.rows[0].id;

        // Thêm vào bảng product_details
        await pool.query(`
            INSERT INTO product_details (product_id, specifications, warranty, usage_instructions, additional_info) 
            VALUES ($1, $2, $3, $4, $5)
        `, [productId, specifications, warranty, usage_instructions, additional_info]);

        // Thêm ảnh vào product_images nếu có
        if (req.files["product_images"]) {
            const imageQueries = req.files["product_images"].map(file => {
                return pool.query(`INSERT INTO product_images (product_id, image_url) VALUES ($1, $2)`, [productId, `/img/${file.filename}`]);
            });
            await Promise.all(imageQueries);
        }

        res.redirect('/admin/add-product?success=1');
    } catch (error) {
        console.error("Lỗi khi thêm sản phẩm:", error);
        res.status(500).send("Lỗi server!");
    }
});

app.get('/admin/add-combo', async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, price FROM products"); // Lấy danh sách sản phẩm
        res.render('admin-add-combo.ejs', { products: result.rows });
    } catch (error) {
        console.error("Lỗi khi lấy danh sách sản phẩm:", error);
        res.status(500).send("Lỗi server!");
    }
});
app.post('/admin/add-combo', upload.single("image"), async (req, res) => {
    try {
        const { name, description, final_price, discount, product_ids, quantities } = req.body;

        // Chuyển đổi dữ liệu
        const comboPrice = parseFloat(final_price);
        const comboDiscount = parseFloat(discount) || 0;
        // console.log(final_price);
        // console.log(typeof final_price);
        const imageUrl = req.file ? req.file.filename : null; // Lưu đường dẫn ảnh
        // const image = req.files["image"] ? req.files["image"][0].filename : null;

        // const image = req.files["image"] ? req.files["image"][0].filename : null;
        // Thêm vào bảng combos
        const comboResult = await pool.query(
            "INSERT INTO combos (name, description, price, discount, image) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [name, description, comboPrice, comboDiscount, `/img/${imageUrl}`]
        );
        const comboId = comboResult.rows[0].id;

        // Thêm sản phẩm vào combo_products
        if (Array.isArray(product_ids)) {
            for (let i = 0; i < product_ids.length; i++) {
                await pool.query(
                    "INSERT INTO combo_products (combo_id, product_id, quantity) VALUES ($1, $2, $3)",
                    [comboId, product_ids[i], quantities[i]]
                );
            }
        }

        res.redirect('/admin/combos'); // Quay về trang danh sách combo
    } catch (error) {
        console.error("Lỗi khi thêm combo:", error);
        res.status(500).send("Lỗi server!");
    }
});

app.get('/admin/combos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.name, c.price, c.discount, 
                   STRING_AGG(p.name || ' (' || cp.quantity || ')', ', ') AS products
            FROM combos c
            LEFT JOIN combo_products cp ON c.id = cp.combo_id
            LEFT JOIN products p ON cp.product_id = p.id
            GROUP BY c.id
        `);
        res.render("admin-combo.ejs", { combos: result.rows });
    } catch (error) {
        console.error("Lỗi khi lấy danh sách combo:", error);
        res.status(500).send("Lỗi server!");
    }
});

app.get('/admin/products', async (req, res) => {
    try {
        const result = await pool.query("select * from products");
        res.render("admin-product.ejs", { product: result.rows })
    } catch (error) {
        console.error("Lỗi khi lấy danh sách product:", error);
        res.status(500).send("Lỗi server!");
    }
})

app.get('/admin/delete-combo/:id', async (req, res) => {
    const combodeleteID = req.params.id;
    try {
        await pool.query('DELETE FROM combos WHERE id = $1', [combodeleteID]);
        res.redirect('/admin/combos');
    } catch (error) {
        console.error("Lỗi khi xóa combos:", error);
        res.status(500).send("Lỗi server!");
    }
});
app.get('/admin/edit-combo/:id', async (req, res) => {
    const comboId = req.params.id;
    try {
        const comboResult = await pool.query('SELECT * FROM combos WHERE id = $1', [comboId]);
        const productResult = await pool.query('SELECT * FROM products');

        const comboProductsResult = await pool.query(
            'SELECT product_id, quantity FROM combo_products WHERE combo_id = $1',
            [comboId]
        );

        const combo = comboResult.rows[0];
        combo.products = comboProductsResult.rows.map(p => ({
            id: p.product_id,
            quantity: p.quantity
        }));

        res.render('admin-edit-combo.ejs', { combo, products: productResult.rows });
    } catch (error) {
        console.error("Lỗi khi lấy dữ liệu combo:", error);
        res.status(500).send("Lỗi server!");
    }
});
app.post('/admin/edit-combo/:id', upload.single('image'), async (req, res) => {
    const comboId = req.params.id;
    const { name, description, discount, product_ids, quantities, final_price } = req.body;
    const image = req.file ? req.file.filename : null;


    try {
        // console.log(typeof final_price)
        // console.log(final_price)
        if (req.file) {
            await pool.query('UPDATE combos SET name = $1, description = $2, discount = $3, price = $4, image = COALESCE($5, image) WHERE id = $6',
                [name, description, discount, final_price, `/img/${image}`, comboId]);
        } else {
            await pool.query('UPDATE combos SET name = $1, description = $2, discount = $3, price = $4 WHERE id = $5',
                [name, description, discount, final_price, comboId]);
        }


        // Xóa sản phẩm cũ và cập nhật sản phẩm mới
        await pool.query('DELETE FROM combo_products WHERE combo_id = $1', [comboId]);

        if (Array.isArray(product_ids)) {
            for (let i = 0; i < product_ids.length; i++) {
                await pool.query('INSERT INTO combo_products (combo_id, product_id, quantity) VALUES ($1, $2, $3)',
                    [comboId, product_ids[i], quantities[i]]);
            }
        }

        res.redirect('/admin/combos');
    } catch (error) {
        console.error("Lỗi khi cập nhật combo:", error);
        res.status(500).send("Lỗi server!");
    }
});


app.get('/admin/product/delete/:id', async (req, res) => {
    const idDeleteProduct = req.params.id;
    try {
        await pool.query("delete from products where id = $1", [idDeleteProduct]);
        res.redirect('/admin/products');
    } catch (error) {
        console.error("Lỗi khi Xóa Product:", error);
        res.status(500).send("Lỗi server!");
    }
})
app.get('/admin/product/edit/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const productQuery = 'SELECT * FROM products WHERE id = $1';
        const productDetailsQuery = 'SELECT * FROM product_details WHERE product_id = $1';
        const productImagesQuery = 'SELECT * FROM product_images WHERE product_id = $1';
        const categoriesQuery = 'SELECT * FROM categories';

        const product = (await pool.query(productQuery, [id])).rows[0];
        const productDetails = (await pool.query(productDetailsQuery, [id])).rows[0];
        const productImages = (await pool.query(productImagesQuery, [id])).rows;
        const categories = (await pool.query(categoriesQuery)).rows;

        if (!product) {
            return res.status(404).send("Sản phẩm không tồn tại");
        }

        res.render('admin-edit-product.ejs', { product, productDetails, productImages, categories });
    } catch (error) {
        console.error("Lỗi khi lấy thông tin sản phẩm:", error);
        res.status(500).send("Lỗi server!");
    }
});
// Xử lý cập nhật sản phẩm
app.post('/admin/product/edit/:id', upload.fields([{ name: "image" }, { name: "product_images" }]), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, stock, specifications, warranty, category_id, usage_instructions, additional_info } = req.body;

        // Xử lý ảnh đại diện
        const image = req.files["image"] ? req.files["image"][0].filename : null;
        if (req.files["image"]) {
            // Cập nhật thông tin sản phẩm
            const updateProductQuery = `
            UPDATE products SET name = $1, description = $2, price = $3, category_id = $4, stock = $5,image = COALESCE($6, image)
            WHERE id = $7;
            `;
            await pool.query(updateProductQuery, [name, description, price, category_id, stock, `/img/${image}`, id]);
        } else {
            // Cập nhật thông tin sản phẩm
            const updateProductQuery = `
                UPDATE products SET name = $1, description = $2, price = $3, category_id = $4, stock = $5 WHERE id = $6;
            `;
            await pool.query(updateProductQuery, [name, description, price, category_id, stock, id]);
        }
        // Cập nhật chi tiết sản phẩm
        const updateDetailsQuery = `
            UPDATE product_details
            SET specifications = $2,
                warranty = $3,
                usage_instructions = $4,
                additional_info = $5    
            WHERE product_id = $1;
        `;
        await pool.query(updateDetailsQuery, [id, specifications, warranty, usage_instructions, additional_info]);

        // Xử lý ảnh sản phẩm mới
        if (req.files["product_images"]) {
            // Xóa hết ảnh cũ của sản phẩm trước
            await pool.query(`DELETE FROM product_images WHERE product_id = $1`, [id]);

            // Thêm ảnh mới vào bảng product_images
            const imageQueries = req.files["product_images"].map(file => {
                return pool.query(`INSERT INTO product_images (product_id, image_url) VALUES ($1, $2)`, [id, file.filename]);
            });
            await Promise.all(imageQueries);
        }
        res.redirect('/admin/products');
    } catch (error) {
        console.error("Lỗi khi cập nhật sản phẩm:", error);
        res.status(500).send("Lỗi server!");
    }
});

app.get('/information-detail', async (req, res) => {
    // console.log(req.user);
    try {
        const user_detail = await pool.query("select * from user_detail where user_id = $1", [req.user.id])
        // console.log(user_detail);
        res.render("information-detail.ejs", {
            user: req.isAuthenticated() ? req.user : null,
            user_detail: user_detail.rows[0] || {}
        });
    } catch (error) {
        console.error("Lỗi khi vào information detail:", error);
        res.status(500).send("Lỗi server!");
    }
})
app.post('/update-information', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');
    }

    try {
        // console.log("hello update-information")
        const { display_name, phone, shipping_address, date_of_birth, gender } = req.body;
        const userId = req.user.id;

        // Cập nhật bảng `users`
        await pool.query("UPDATE users SET display_name = $1 WHERE id = $2", [display_name, userId]);

        // Kiểm tra xem user_detail có tồn tại không
        const result = await pool.query("SELECT * FROM user_detail WHERE user_id = $1", [userId]);

        if (result.rows.length > 0) {
            // Nếu đã có, cập nhật thông tin
            await pool.query(
                "UPDATE user_detail SET phone = $1, shipping_address = $2, date_of_birth = $3, gender = $4 WHERE user_id = $5",
                [phone, shipping_address, date_of_birth || null, gender, userId]
            );
        } else {
            // Nếu chưa có, thêm mới
            await pool.query(
                "INSERT INTO user_detail (user_id, phone, shipping_address, date_of_birth, gender) VALUES ($1, $2, $3, $4, $5)",
                [userId, phone, shipping_address, date_of_birth || null, gender]
            );
        }

        res.redirect('/information-detail'); // Quay lại trang thông tin
    } catch (error) {
        console.error("Lỗi khi cập nhật thông tin:", error);
        res.status(500).send("Lỗi server!");
    }
});
app.post("/upload-avatar", upload.single("image"), async (req, res) => {
    // console.log("hello upload-avatar")

    if (!req.isAuthenticated()) {
        return res.redirect("/login");
    }

    try {
        const image = req.file ? req.file.filename : null;
        // console.log(image)
        const userId = req.user.id;
        // const image = req.file.filename; // Đường dẫn ảnh mới

        // Cập nhật ảnh đại diện trong database
        // console.log("hello")
        await pool.query("UPDATE users SET avatar = COALESCE($1, avatar) WHERE id = $2", [`/img/${image}`, userId]);
        // console.log(typeof req.file)
        res.redirect("/information-detail"); // Quay lại trang thông tin
    } catch (error) {
        console.error("Lỗi khi cập nhật ảnh đại diện:", error);
        res.status(500).send("Lỗi server!");
    }
});

app.get("/admin-information", async (req, res) => {
    try {
        const users = await pool.query("SELECT id, display_name, email, role, created_at FROM users ORDER BY role DESC, created_at DESC");
        res.render("admin-information.ejs", { users: users.rows });
    } catch (error) {
        console.error("Lỗi khi lấy danh sách người dùng:", error);
        res.status(500).send("Lỗi server!");
    }
});
app.post("/change-role", async (req, res) => {
    const { userId, newRole } = req.body;

    try {
        await pool.query("UPDATE users SET role = $1 WHERE id = $2", [newRole, userId]);
        res.redirect("/admin-information");
    } catch (error) {
        console.error("Lỗi khi cập nhật quyền người dùng:", error);
        res.status(500).send("Lỗi server!");
    }
});

app.get('/cart', async (req, res) => {
    if (!req.user) {
        return res.redirect('/login');
    }
    try {
        const item = await pool.query(`
            SELECT 
                    cart.id AS cart_id, 
                    products.id AS product_id, 
                    products.name as name, 
                    products.description , 
                    products.price as price, 
                    products.image as image, 
                    cart.quantity as quantity, 
                    (cart.quantity * products.price) AS total_price, 
                    cart.created_at as created_at
                FROM cart
                JOIN products ON cart.product_id = products.id
                WHERE cart.user_id = $1;

            `, [req.user.id])

        // console.log(item);
        res.render("cart.ejs", {
            user: req.isAuthenticated() ? req.user : null,
            item: item.rows,
            errorMessage: ""
        })
    } catch (error) {
        console.error("Lỗi khi lấy danh sách người dùng:", error);
        res.status(500).send("Lỗi server!");
    }
})
app.get('/remove-cart/:id', async (req, res) => {
    if (!req.user.id) {
        return res.status(401).send("Bạn cần đăng nhập để thực hiện thao tác này.");
    }
    try {
        const productId = req.params.id;
        await pool.query(
            'DELETE FROM cart WHERE product_id = $1 AND user_id = $2',
            [productId, req.user.id]
        );
        res.redirect('/cart');
    } catch (error) {
        console.error("Lỗi khi lấy danh sách người dùng:", error);
        res.status(500).send("Lỗi server!");
    }
})
app.post('/cart', async (req, res) => {
    if (!req.user) {
        return res.redirect('/login'); // Chuyển hướng nếu chưa đăng nhập
    }

    const { product_id, quantity, action } = req.body;

    // Chuyển thành số nguyên
    const productId = parseInt(product_id, 10);
    const quantityInt = parseInt(quantity, 10);
    // console.log(typeof productId)
    try {
        // Kiểm tra sản phẩm có tồn tại không
        const productCheck = await pool.query("SELECT id FROM products WHERE id = $1", [productId]);

        if (productCheck.rowCount === 0) {
            return res.status(400).send("Sản phẩm không tồn tại!");
        }

        if (action === "add-to-cart") {
            console.log(`Thêm ${quantityInt} sản phẩm có id ${productId} vào giỏ hàng`);
            await pool.query(
                `INSERT INTO cart (user_id, product_id, quantity) 
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, product_id) 
                 DO UPDATE SET quantity = cart.quantity + EXCLUDED.quantity`,
                [req.user.id, productId, quantityInt]
            );
            return res.redirect(`product/${productId}`)
        } else if (action === "buy-now") {
            console.log(`Mua ngay ${quantityInt} sản phẩm`);
            await pool.query("delete from cart where user_id =$1", [req.user.id]);
            await pool.query(
                `INSERT INTO cart (user_id, product_id, quantity) 
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, product_id) 
                 DO UPDATE SET quantity = cart.quantity + EXCLUDED.quantity`,
                [req.user.id, productId, quantityInt]
            );
            return res.redirect('/cart');
        } else {
            return res.status(400).send("Hành động không hợp lệ");
        }
    } catch (err) {
        console.error(err);
        return res.status(500).send("Lỗi server!");
    }
});

app.post('/buy_cart', async (req, res) => {
    try {
        if (!req.user) {
            return res.redirect('/login');
        }

        let { product_id, quantity } = req.body;
        // Chuyển thành mảng nếu chỉ có một sản phẩm
        // Đảm bảo luôn là mảng
        product_id = Array.isArray(product_id) ? product_id : product_id ? [product_id] : [];
        quantity = Array.isArray(quantity) ? quantity : quantity ? [quantity] : [];
        if (product_id.length === 0 || quantity.length === 0) {
            return res.render("cart.ejs", {
                user: req.isAuthenticated() ? req.user : null,
                item: [],
                errorMessage: "Giỏ hàng của bạn đang trống!"
            });
        }
        // Bắt đầu transaction
        await pool.query("BEGIN");

        let errorMessage = null; // Nếu có lỗi, sẽ lưu tin nhắn lỗi vào đây
        let item = [];

        for (let i = 0; i < product_id.length; i++) {
            const productId = parseInt(product_id[i], 10);
            const quantityInt = parseInt(quantity[i], 10);

            if (!Number.isInteger(productId) || !Number.isInteger(quantityInt) || quantityInt < 1) {
                errorMessage = "Sản phẩm hoặc số lượng không hợp lệ!";
                break;
            }

            // Kiểm tra tồn kho
            const stockProduct = await pool.query("SELECT * FROM products WHERE id=$1", [productId]);
            const stockProductRows = stockProduct.rows[0]?.stock || 0;

            if (stockProductRows < quantityInt) {
                const nameProduct = await pool.query("SELECT name FROM products WHERE id = $1", [productId]);
                errorMessage = `Không đủ số lượng của sản phẩm ${nameProduct.rows[0].name} chỉ còn ${stockProductRows} sản phẩm`;
                break;
            }

            // Trừ số lượng sản phẩm trong kho
            //await pool.query("UPDATE products SET stock = $1 WHERE id = $2", [(stockProductRows - quantityInt), productId]);

            // Cập nhật giỏ hàng
            await pool.query(
                "UPDATE cart SET quantity = $1 WHERE user_id = $2 AND product_id = $3",
                [quantityInt, req.user.id, productId]
            );
        }

        if (errorMessage) {
            // Nếu có lỗi, rollback để hoàn tác tất cả thay đổi trước đó
            await pool.query("ROLLBACK");

            // Lấy lại giỏ hàng để hiển thị
            item = await pool.query(`
                SELECT 
                    cart.id AS cart_id, 
                    products.id AS product_id, 
                    products.name as name, 
                    products.description, 
                    products.price as price, 
                    products.image as image, 
                    cart.quantity as quantity, 
                    (cart.quantity * products.price) AS total_price, 
                    cart.created_at as created_at
                FROM cart
                JOIN products ON cart.product_id = products.id
                WHERE cart.user_id = $1;
            `, [req.user.id]);

            return res.render("cart.ejs", {
                user: req.isAuthenticated() ? req.user : null,
                item: item.rows,
                errorMessage
            });
        }

        // Nếu không có lỗi, commit transaction để lưu thay đổi
        await pool.query("COMMIT");

        // Kiểm tra thông tin người dùng
        const userDB = await pool.query("SELECT * FROM user_detail WHERE user_id = $1", [req.user.id]);
        const userDB1 = userDB.rows.length > 0 ? userDB.rows[0] : {};

        if (!userDB1.phone || !userDB1.shipping_address) {
            return res.redirect('/information-detail');
        } else {
            return res.redirect('/payments-cart');
        }

    } catch (error) {
        // Nếu có lỗi trong quá trình xử lý, rollback transaction
        await pool.query("ROLLBACK");
        console.error("Lỗi khi mua hàng:", error);
        return res.status(500).send("Lỗi server!");
    }
});

app.get('/payments-cart', async (req, res) => {
    try {
        const user_detail = await pool.query(`
                select * from user_detail where user_id = $1
            `, [req.user.id]);

        const dbAll = await pool.query(`
                        SELECT 
                -- Bảng users
                u.id AS user_id,
                u.google_id AS user_google_id,
                u.display_name AS user_display_name,
                u.email AS user_email,
                u.avatar AS user_avatar,
                u.password AS user_password,
                u.created_at AS user_created_at,
                u.role AS user_role,

                -- Bảng user_detail
                ud.id AS user_detail_id,
                ud.phone AS user_phone,
                ud.shipping_address AS user_shipping_address,
                ud.full_name AS user_full_name,
                ud.date_of_birth AS user_date_of_birth,
                ud.gender AS user_gender,
                ud.created_at AS user_detail_created_at,

                -- Bảng cart
                c.id AS cart_id,
                c.product_id AS cart_product_id,
                c.quantity AS cart_quantity,
                c.created_at AS cart_created_at,

                -- Bảng products
                p.id AS product_id,
                p.name AS product_name,
                p.description AS product_description,
                p.price AS product_price,
                p.image AS product_image,
                p.category_id AS product_category_id,
                p.stock AS product_stock,
                p.created_at AS product_created_at

            FROM users u
            LEFT JOIN user_detail ud ON u.id = ud.user_id
            LEFT JOIN cart c ON u.id = c.user_id
            LEFT JOIN products p ON c.product_id = p.id
            WHERE u.id = $1

                        `, [req.user.id])

        res.render("payments.ejs", {
            user: req.isAuthenticated() ? req.user : null,
            item: dbAll.rows,
            userDetail: user_detail.rows[0]
        })
    } catch (error) {
        console.error("Lỗi khi Thanh Toán Get:", error);
        return res.status(500).send("Lỗi server!");
    }
})
app.post('/payments-cart', async (req, res) => {

    try {
        // Trừ số lượng sản phẩm trong kho
        console.log("Dữ liệu nhận được từ form:", req.body);
        const paymentMethod = req.body.payment_method; // Lấy giá trị từ form
        let { product_id, quantity, discount } = req.body;
        const note = req.body.note;
        // console.log(product_id)
        // console.log(quantity)
        // console.log(discount)
        for (let i = 0; i < product_id.length; i++) {
            const productId = parseInt(product_id[i], 10);
            const quantityInt = parseInt(quantity[i], 10);
            // Kiểm tra tồn kho
            const stockProduct = await pool.query("SELECT * FROM products WHERE id=$1", [productId]);
            const stockProductRows = stockProduct.rows[0]?.stock || 0;
            await pool.query("UPDATE products SET stock = $1 WHERE id = $2", [(stockProductRows - quantityInt), productId]);
        }
        // Insert cho orders 
        const dbAll = await pool.query(`
                     SELECT 
                -- Bảng users
                u.id AS user_id,
                u.google_id AS user_google_id,
                u.display_name AS user_display_name,
                u.email AS user_email,
                u.avatar AS user_avatar,
                u.password AS user_password,
                u.created_at AS user_created_at,
                u.role AS user_role,

                -- Bảng user_detail
                ud.id AS user_detail_id,
                ud.phone AS user_phone,
                ud.shipping_address AS user_shipping_address,
                ud.full_name AS user_full_name,
                ud.date_of_birth AS user_date_of_birth,
                ud.gender AS user_gender,
                ud.created_at AS user_detail_created_at,

                -- Bảng cart
                c.id AS cart_id,
                c.product_id AS cart_product_id,
                c.quantity AS cart_quantity,
                c.created_at AS cart_created_at,

                -- Bảng products
                p.id AS product_id,
                p.name AS product_name,
                p.description AS product_description,
                p.price AS product_price,
                p.image AS product_image,
                p.category_id AS product_category_id,
                p.stock AS product_stock,
                p.created_at AS product_created_at

            FROM users u
            LEFT JOIN user_detail ud ON u.id = ud.user_id
            LEFT JOIN cart c ON u.id = c.user_id
            LEFT JOIN products p ON c.product_id = p.id
            WHERE u.id = $1

            `, [req.user.id]);
        let totalAmount = 0;
        await Promise.all(dbAll.rows.map(async (item) => {
            totalAmount += item.product_price * item.cart_quantity;
        }));
        // console.log("Giá Bình Thường " + totalAmount);
        if (discount > 0) {
            totalAmount = totalAmount * (1 - discount / 100);
            // console.log("Giá Giảm" + totalAmount);
        }
        // Tạo đơn hàng và lấy order_id ngay sau khi tạo
        const orderResult = await pool.query(
            "INSERT INTO orders (user_id, total_price,payment_method,note) VALUES ($1, $2, $3,$4) RETURNING id",
            [req.user.id, totalAmount,paymentMethod,note]
        );
        const order_id = orderResult.rows[0].id; // Lấy ID của đơn hàng vừa tạo

        // Chèn các sản phẩm vào order_items với order_id hợp lệ
        for (const item of dbAll.rows) {
            await pool.query(
                "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
                [order_id, item.product_id, item.cart_quantity, item.product_price]
            );
        }

        // Lây phương thức thanh toán ;
        
        console.log("Phương thức thanh toán:", paymentMethod);

        if (paymentMethod === "QR") {
            // Xử lý thanh toán qua mã QR
        } else if (paymentMethod === "BankTransfer") {
            // Xử lý thanh toán qua chuyển khoản
        } else {
            // Xử lý COD
        }
        //Xóa giỏ hàng 
        await pool.query("delete from cart where user_id=$1", [req.user.id]);
        // Lấy note 
        

        console.log("Lời nhắn:", note);
        res.render('order_success.ejs', {
            user: req.isAuthenticated() ? req.user : null
        });
    } catch (error) {
        console.error("Lỗi khi Thanh Toán Post:", error);
        return res.status(500).send("Lỗi server!");
    }
})
app.post('/payments-cart2', async (req, res) => {

    try {
        // Trừ số lượng sản phẩm trong kho
        console.log("Dữ liệu nhận Combo được từ form:", req.body);
        const paymentMethod = req.body.payment_method;
        const note = req.body.note;
        let { product_id, quantity, discount, combo_price, combo_id } = req.body;
        const discountID = parseInt(discount, 10);
        const comboPrice = parseInt(combo_price, 10);
        const comboID = parseInt(combo_id, 10);
        console.log(discount)
        for (let i = 0; i < product_id.length; i++) {
            const productId = parseInt(product_id[i], 10);
            const quantityInt = parseInt(quantity[i], 10);
            // Kiểm tra tồn kho
            const stockProduct = await pool.query("SELECT * FROM products WHERE id=$1", [productId]);
            const stockProductRows = stockProduct.rows[0]?.stock || 0;
            if (stockProductRows < quantityInt) {
                //return res.send("DA HET SAN PHAM id "+productId);
                const messageErr = `Hết sản phẩm ${stockProduct.rows[0].name} chỉ còn ${stockProduct.rows[0].stock} sản phẩm `
                return res.render("errorNoProduct.ejs", {
                    user: req.isAuthenticated() ? req.user : null,
                    message: messageErr
                })
            }
            await pool.query("UPDATE products SET stock = $1 WHERE id = $2", [(stockProductRows - quantityInt), productId]);
        }
        // Insert cho orders 
        // Tạo đơn hàng và lấy order_id ngay sau khi tạo
        const orderResult = await pool.query(
            "INSERT INTO orders (user_id, total_price,payment_method,note,discount) VALUES ($1, $2, $3,$4,$5) RETURNING id",
            [req.user.id, comboPrice,paymentMethod,note,discountID]
        );
        const order_id = orderResult.rows[0].id; // Lấy ID của đơn hàng vừa tạo

        // Chèn các sản phẩm vào order_items với order_id hợp lệ
        const dbAll = await pool.query(`
            SELECT p.id, p.name, p.price, cp.quantity
            FROM combo_products cp
            JOIN products p ON cp.product_id = p.id
	            WHERE cp.combo_id = $1
            `, [comboID])

        for (const item of dbAll.rows) {
            await pool.query(
                "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
                [order_id, item.id, item.quantity, item.price]
            );
        }

        // Lây phương thức thanh toán ;
         // Lấy giá trị từ form
        console.log("Phương thức thanh toán:", paymentMethod);

        if (paymentMethod === "QR") {
            // Xử lý thanh toán qua mã QR
        } else if (paymentMethod === "BankTransfer") {
            // Xử lý thanh toán qua chuyển khoản
        } else {
            // Xử lý COD
        }
        //Xóa giỏ hàng 
        await pool.query("delete from cart where user_id=$1", [req.user.id]);
        // Lấy note 
        

        console.log("Lời nhắn:", note);
        return res.render('order_success.ejs', {
            user: req.isAuthenticated() ? req.user : null
        });
    } catch (error) {
        console.error("Lỗi khi Thanh Toán Post:", error);
        return res.status(500).send("Lỗi server!");
    }
})
app.post('/payment-combo', async (req, res) => {
    if (!req.user) {
        return res.redirect('/login'); // Chuyển hướng nếu chưa đăng nhập
    }
    try {

        const comboID = req.body.combo_id;
        const userDetail = await pool.query('select * from user_detail where user_id=$1', [req.user.id]);
        const productDetail = await pool.query(`
            SELECT p.id, p.name, p.price, cp.quantity
            FROM combo_products cp
            JOIN products p ON cp.product_id = p.id
	            WHERE cp.combo_id = $1
            `, [comboID]);

        const comboDetail = await pool.query(`
            select * from combos where id=$1
            `, [comboID]);
        // Kiểm tra thông tin người dùng
        const userDB = await pool.query("SELECT * FROM user_detail WHERE user_id = $1", [req.user.id]);
        const userDB1 = userDB.rows.length > 0 ? userDB.rows[0] : {};

        if (!userDB1.phone || !userDB1.shipping_address) {
            return res.redirect('/information-detail');
        } else {
            return res.render("payment-combo.ejs", {
                user: req.isAuthenticated() ? req.user : null,
                userDetail: userDetail.rows[0],
                item: productDetail.rows,
                combo: comboDetail.rows[0]
            });
        }

    } catch (error) {
        console.error("Lỗi khi Thanh Toán Combos:", error);
        return res.status(500).send("Lỗi server!");
    }
})


app.get('/purchase-history', async (req, res) => {
    try {
        const order = await pool.query('select * from orders where user_id=$1', [req.user.id]);
        res.render('purchase-history.ejs', {
            user: req.isAuthenticated() ? req.user : null,
            purchases: order.rows
        })
    } catch (error) {
        console.error("Lỗi khi Xem lịch sử mua hàng :", error);
        return res.status(500).send("Lỗi server!");
    }
})

app.get('/purchase-history-detail/:id', async (req, res) => {
    const order_id = req.params.id;
    try {
        const item = await pool.query(`
                            SELECT 
                oi.id AS order_item_id,
                oi.order_id,
                oi.quantity AS order_item_quantity,
                oi.price AS order_item_price,
                p.id AS product_id,
                p.name AS product_name,
                p.description AS product_description,
                p.price AS product_price,
                p.image AS product_image,
                p.category_id AS product_category_id,
                p.stock AS product_stock,
                p.created_at AS product_created_at
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = $1;

                `, [order_id]);

        res.render('purchase-history-detail.ejs',{
            user: req.isAuthenticated() ? req.user : null,
            orderItems:item.rows
        })      
    } catch (error) {
        console.error("Lỗi khi Xem lịch sử mua hàng chi tiếttiết :", error);
        return res.status(500).send("Lỗi server!");
    }
})
app.get('/admin-purchase-history',async (req,res) => {
    try {
        const purchase = await pool.query(`
                            SELECT 
                    o.id AS order_id,
                    o.user_id,
                    u.display_name,
                    u.email,
                    u.avatar,
                    ud.phone,
                    ud.shipping_address,
                    o.total_price,
                    o.status,
                    o.created_at,
                    o.payment_method,
                    o.note
                FROM orders o
                JOIN users u ON o.user_id = u.id
                LEFT JOIN user_detail ud ON u.id = ud.user_id

                ORDER BY o.created_at DESC;
            `)
        res.render('admin-purchase-history.ejs',{
            user: req.isAuthenticated() ? req.user : null,
            purchases:purchase.rows
        })
    } catch (error) {
        console.error("Lỗi khi Admin Xem lịch sử mua hàng :", error);
        return res.status(500).send("Lỗi server!");
    }
})
app.get('/admin-purchase',async (req,res) => {
    try {
        const purchase = await pool.query(`
                            SELECT 
                    o.id AS order_id,
                    o.user_id,
                    u.display_name,
                    u.email,
                    u.avatar,
                    ud.phone,
                    ud.shipping_address,
                    o.total_price,
                    o.status,
                    o.created_at,
                    o.payment_method,
                    o.note
                FROM orders o
                JOIN users u ON o.user_id = u.id
                LEFT JOIN user_detail ud ON u.id = ud.user_id

                ORDER BY o.created_at DESC;
            `)
        res.render('admin-purchase.ejs',{
            user: req.isAuthenticated() ? req.user : null,
            purchases:purchase.rows
        })
    } catch (error) {
        console.error("Lỗi khi Admin Xem lịch sử mua hàng :", error);
        return res.status(500).send("Lỗi server!");
    }
})
app.post('/admin/update-status', async (req, res) => {
    try {
        const order_id = req.body.order_id;
        const orderInt = parseInt(order_id, 10);
        const status = req.body.status;

        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderInt]);

        // Kiểm tra nếu trạng thái là 'completed' hoặc 'canceled'
        if (status === 'completed' || status === 'canceled') {
            return res.redirect('/admin-purchase-history');
        } else {
            return res.redirect('/admin-purchase');
        }
    } catch (error) {
        console.error("Lỗi khi Admin Update Status:", error);
        return res.status(500).send("Lỗi server!");
    }
});

app.get('/admin-purchase-detail/:id',async (req,res) => {
    try {
        const order_id = req.params.id;
        const user=await pool.query(`
                                        SELECT 
                    o.id AS order_id,
                    o.user_id,
                    u.display_name,
                    u.email,
                    ud.phone,
                    ud.shipping_address,
                    o.total_price,
                    o.created_at,
                    o.payment_method,
                    o.note,
					o.discount
                FROM orders o
                JOIN users u ON o.user_id = u.id
                LEFT JOIN user_detail ud ON u.id = ud.user_id
				WHERE o.id=$1
                ORDER BY o.created_at DESC;
            
            `,[order_id]);
        const item=await pool.query(`
                            SELECT 
                    order_items.quantity,
                    order_items.price AS price,
                    products.name AS name
                FROM order_items
                JOIN products ON order_items.product_id = products.id
                WHERE order_items.order_id = $1;

            `,[order_id]);
        res.render('admin-purchase-detail.ejs',{
            user:user.rows[0],
            item:item.rows
        })
    } catch (error) {
        console.error("Lỗi khi Admin Xem đơn hàng chi tiết  :", error);
        return res.status(500).send("Lỗi server!");
    }
})
// Khởi động server
app.listen(3000, () => console.log('Server đang chạy tại http://localhost:3000'));

