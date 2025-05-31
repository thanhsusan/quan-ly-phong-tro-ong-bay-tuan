import React, { useState, useEffect, createContext, useContext, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, query, where, getDoc, setDoc, getDocs } from 'firebase/firestore';

// Context để chia sẻ trạng thái Firebase và người dùng
const FirebaseContext = createContext(null);

// Helper function to format date from 2025-MM-DD to DD/MM/YYYY
const formatDisplayDate = (dateString) => {
    if (!dateString) return 'N/A';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
};

// Helper function to format date for invoice code (DD/MM/YY)
const formatInvoiceDate = (dateString) => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year.substring(2)}`;
};

// Component Provider cho Firebase
const FirebaseProvider = ({ children }) => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loadingFirebase, setLoadingFirebase] = useState(true);
    const [isAuthReady, setIsAuthReady] = useState(false); // New state to track auth readiness

    useEffect(() => {
        const initializeFirebase = async () => {
            try {
                // User-provided Firebase config
                const userProvidedFirebaseConfig = {
                    apiKey: "AIzaSyA0qRdQY0pyHwUmSp9I6B-pRTQnjCGGRYM",
                    authDomain: "quan-ly-phong-tro-ong-bay-tuan.firebaseapp.com",
                    projectId: "quan-ly-phong-tro-ong-bay-tuan",
                    storageBucket: "quan-ly-phong-tro-ong-bay-tuan.firebasestorage.app",
                    messagingSenderId: "346457486330",
                    appId: "1:346457486330:web:29e8ed926fc6a600b96a43",
                    measurementId: "G-74WZ5DPPC8"
                };

                let firebaseConfigToUse = userProvidedFirebaseConfig;

                // Check if __firebase_config is defined and not empty, then use it
                if (typeof __firebase_config !== 'undefined' && Object.keys(JSON.parse(__firebase_config)).length > 0) {
                    firebaseConfigToUse = JSON.parse(__firebase_config);
                }

                const app = initializeApp(firebaseConfigToUse);
                const firestore = getFirestore(app);
                const authInstance = getAuth(app);

                setDb(firestore);
                setAuth(authInstance);

                // Lắng nghe thay đổi trạng thái xác thực
                onAuthStateChanged(authInstance, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        // Nếu người dùng đăng xuất hoặc chưa đăng nhập, thử đăng nhập ẩn danh
                        try {
                            const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                            if (initialAuthToken) {
                                await signInWithCustomToken(authInstance, initialAuthToken);
                            } else {
                                await signInAnonymously(authInstance);
                            }
                            setUserId(authInstance.currentUser?.uid); // Set userId from current user after sign-in
                        } catch (anonError) {
                            console.error("Lỗi đăng nhập ẩn danh:", anonError);
                            setUserId(null); // Explicitly null if anonymous sign-in fails
                        }
                    }
                    setIsAuthReady(true); // Auth state has been checked
                    setLoadingFirebase(false);
                });

            } catch (error) {
                console.error("Lỗi khi khởi tạo Firebase:", error);
                setLoadingFirebase(false);
                setIsAuthReady(true); // Still set to true to unblock the app, even if init failed
            }
        };

        initializeFirebase();
    }, []);

    // Wait for Firebase to be initialized and auth state to be ready
    if (loadingFirebase || !isAuthReady) {
        return (
            <div style={styles.loadingContainer}>
                <div style={styles.loadingText}>Đang tải ứng dụng...</div>
            </div>
        );
    }

    return (
        <FirebaseContext.Provider value={{ db, auth, userId, isAuthReady }}>
            {children}
        </FirebaseContext.Provider>
    );
};

// Component Modal tùy chỉnh thay thế alert/confirm
const CustomModal = ({ title, message, onConfirm, onCancel, showCancel = true, showModal }) => {
    if (!showModal) return null; // Không hiển thị modal nếu showModal là false

    return (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
                <h3 style={styles.modalTitle}>{title}</h3>
                <div style={styles.modalMessage}>{message}</div>
                <div style={styles.modalActions}>
                    {showCancel && (
                        <button
                            onClick={onCancel}
                            style={{...styles.button, ...styles.buttonSecondary}}
                        >
                            Hủy
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        style={{...styles.button, ...styles.buttonPrimary}}
                    >
                        Xác nhận
                    </button>
                </div>
            </div>
        </div>
    );
};

// Component để xử lý thanh toán hóa đơn
const PaymentModal = ({ bill, onClose, onProcessPayment, setModalState }) => {
    const [paymentAmount, setPaymentAmount] = useState(bill.remainingAmount || bill.totalAmount);
    const [isProcessing, setIsProcessing] = useState(false);

    const handlePayment = async () => {
        if (paymentAmount <= 0) {
            setModalState({
                title: "Lỗi",
                message: "Số tiền thanh toán phải lớn hơn 0.",
                showCancel: false,
                action: () => setModalState({ showModal: false })
            });
            return;
        }
        setIsProcessing(true);
        await onProcessPayment(bill.id, bill.roomId, paymentAmount);
        setIsProcessing(false);
        onClose();
    };

    return (
        <CustomModal
            title={`Thanh toán Hóa đơn Phòng ${bill.roomNumber}`}
            message={
                <div>
                    <p style={styles.modalText}>Tổng tiền hóa đơn: <span style={styles.modalTextBold}>{bill.totalAmount.toLocaleString('vi-VN')} VNĐ</span></p>
                    <p style={styles.modalText}>Số tiền còn lại: <span style={{...styles.modalTextBold, color: 'red'}}>{bill.remainingAmount.toLocaleString('vi-VN')} VNĐ</span></p>
                    <label htmlFor="paymentAmount" style={styles.formLabel}>Số tiền thanh toán (VNĐ)</label>
                    <input
                        type="number"
                        id="paymentAmount"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                        style={styles.formInput}
                        min="0"
                        step="1000"
                        disabled={isProcessing}
                    />
                </div>
            }
            onConfirm={handlePayment}
            onCancel={onClose}
            showCancel={true}
            showModal={true} // Luôn hiển thị khi component này được render
        />
    );
};

// Component để hiển thị chi tiết hóa đơn
const BillDetailModal = ({ bill, onClose, onEdit, onDelete }) => {
    if (!bill) return null;

    const getPaymentStatusText = (status) => {
        switch (status) {
            case 'Paid': return 'Đã thanh toán';
            case 'Unpaid': return 'Chưa thanh toán';
            case 'Partially Paid': return 'Thanh toán một phần';
            default: return status;
        }
    };

    const getPaymentStatusColor = (status) => {
        switch (status) {
            case 'Paid': return 'green';
            case 'Unpaid': return 'red';
            case 'Partially Paid': return 'orange';
            default: return 'black';
        }
    };

    return (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContentLarge}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>Chi tiết Hóa đơn {bill.invoiceCode}</h3>
                    <button
                        onClick={onClose}
                        style={styles.modalCloseButton}
                    >
                        &times;
                    </button>
                </div>
                <div style={styles.modalBody}>
                    <p><strong>Phòng:</strong> {bill.roomNumber}</p>
                    <p><strong>Người thuê:</strong> {bill.tenantName}</p>
                    <p><strong>Kỳ:</strong> Tháng {bill.billingMonth}/{bill.billingYear}</p>
                    <p><strong>Tiền phòng tháng này:</strong> {bill.rentAmount.toLocaleString('vi-VN')} VNĐ</p>
                    <p><strong>Điện:</strong></p>
                    <ul style={styles.list}>
                        <li>Chỉ số cũ: {bill.previousElectricityMeter}</li>
                        <li>Chỉ số mới: {bill.currentElectricityMeter}</li>
                        <li>Sử dụng: {bill.electricityUsage} kWh</li>
                        <li>Thành tiền: {bill.electricityCost.toLocaleString('vi-VN')} VNĐ</li>
                    </ul>
                    <p><strong>Nước:</strong></p>
                    <ul style={styles.list}>
                        <li>Chỉ số cũ: {bill.previousWaterMeter}</li>
                        <li>Chỉ số mới: {bill.currentWaterMeter}</li>
                        <li>Sử dụng: {bill.waterUsage} m³</li>
                        <li>Thành tiền: {bill.waterCost.toLocaleString('vi-VN')} VNĐ</li>
                    </ul>
                    <p><strong>Internet:</strong> {bill.internetFee.toLocaleString('vi-VN')} VNĐ</p>
                    <p><strong>Rác:</strong> {bill.trashFee.toLocaleString('vi-VN')} VNĐ</p>
                    {bill.otherFeesAmount > 0 && (
                        <p><strong>Phí khác ({bill.otherFeesDescription}):</strong> {bill.otherFeesAmount.toLocaleString('vi-VN')} VNĐ</p>
                    )}
                    <p><strong>Các khoản tháng này:</strong> {bill.currentMonthCharges.toLocaleString('vi-VN')} VNĐ</p>
                    <p style={{color: 'red', fontWeight: 'bold'}}><strong>Nợ cũ còn lại:</strong> {bill.outstandingPreviousDebt.toLocaleString('vi-VN')} VNĐ</p>
                    <p style={{color: 'darkblue', fontWeight: 'bold', fontSize: '1.2em'}}>Tổng cộng phải trả: {bill.totalAmount.toLocaleString('vi-VN')} VNĐ</p>
                    <p><strong>Đã thanh toán:</strong> {(bill.paidAmount || 0).toLocaleString('vi-VN')} VNĐ</p>
                    <p><strong>Còn lại:</strong> <span style={{fontWeight: 'bold', color: getPaymentStatusColor(bill.paymentStatus)}}>{(bill.remainingAmount || 0).toLocaleString('vi-VN')} VNĐ</span></p>
                    <p><strong>Trạng thái thanh toán:</strong> <span style={{fontWeight: 'bold', color: getPaymentStatusColor(bill.paymentStatus)}}>{getPaymentStatusText(bill.paymentStatus)}</span></p>
                    <p><strong>Ngày tạo hóa đơn:</strong> {formatDisplayDate(bill.billDate)}</p>
                    {bill.paymentDate && <p><strong>Ngày thanh toán:</strong> {formatDisplayDate(bill.paymentDate)}</p>}
                </div>
                <div style={styles.modalActions}>
                    <button
                        onClick={() => onEdit(bill)}
                        style={{...styles.button, backgroundColor: 'orange'}}
                    >
                        Sửa
                    </button>
                    <button
                        onClick={() => { onDelete(bill); onClose(); }}
                        style={{...styles.button, backgroundColor: 'red'}}
                    >
                        Xóa
                    </button>
                    <button
                        onClick={onClose}
                        style={{...styles.button, ...styles.buttonSecondary}}
                    >
                        Đóng
                    </button>
                </div>
            </div>
        </div>
    );
};

// Component Đăng nhập
const LoginScreen = ({ auth, setModalState }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsProcessing(true);
        // Display "Đang xử lý..." modal
        setModalState({
            title: "Thông báo",
            message: "Đang xử lý...",
            showCancel: false,
            onConfirm: () => setModalState({ showModal: false }), // Allow closing if stuck
            showModal: true
        });

        try {
            await signInWithEmailAndPassword(auth, email, password);
            // On successful login, onAuthStateChanged in FirebaseProvider will handle the transition
            // No need to set modal state for success here, as it will transition directly.
            setModalState({ showModal: false }); // Close processing modal immediately on success
        } catch (error) {
            console.error("Lỗi xác thực:", error);
            let errorMessage = "Đăng nhập thất bại. Vui lòng kiểm tra lại Email và Mật khẩu.";
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                errorMessage = "Email hoặc mật khẩu không đúng.";
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = "Địa chỉ Email không hợp lệ.";
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.";
            }
            setModalState({
                title: "Lỗi Đăng nhập",
                message: errorMessage,
                showCancel: false,
                onConfirm: () => setModalState({ showModal: false }), // Close modal on error
                showModal: true
            });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div style={styles.loadingContainer}>
            <div style={styles.modalContent}>
                <h2 style={styles.loginTitle}>
                    Đăng nhập Quản Lý Phòng Trọ
                </h2>
                <form onSubmit={handleSubmit} style={styles.loginForm}>
                    <div style={styles.formGroup}>
                        <label htmlFor="email" style={styles.formLabel}>Email</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            style={styles.formInput}
                            disabled={isProcessing}
                        />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="password" style={styles.formLabel}>Mật khẩu</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            style={styles.formInput}
                            disabled={isProcessing}
                        />
                    </div>
                    <button
                        type="submit"
                        style={{...styles.button, ...styles.buttonPrimary, width: '100%'}}
                        disabled={isProcessing}
                    >
                        {isProcessing ? 'Đang đăng nhập...' : 'Đăng nhập'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// Component để chỉnh sửa hóa đơn
const BillEditForm = ({ bill, onSave, onCancel, serviceSettings }) => {
    const [formData, setFormData] = useState({ ...bill });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        // Recalculate derived fields when relevant inputs change
        const electricityUsage = (parseFloat(formData.currentElectricityMeter) || 0) - (parseFloat(formData.previousElectricityMeter) || 0);
        const electricityCost = electricityUsage > 0 ? electricityUsage * (serviceSettings?.electricityPrice || 0) : 0;

        const waterUsage = (parseFloat(formData.currentWaterMeter) || 0) - (parseFloat(formData.previousWaterMeter) || 0);
        const waterCost = waterUsage > 0 ? waterUsage * (serviceSettings?.waterPrice || 0) : 0;

        const rentAmount = parseInt(formData.rentAmount) || 0;
        const internetFee = parseInt(serviceSettings?.internetPrice || 0);
        const trashFee = parseInt(serviceSettings?.trashPrice || 0);
        const otherFees = parseInt(formData.otherFeesAmount) || 0;
        const outstandingPreviousDebt = parseInt(formData.outstandingPreviousDebt) || 0;


        const currentMonthCharges =
            rentAmount +
            electricityCost +
            waterCost +
            internetFee +
            trashFee +
            otherFees;

        const totalAmount = currentMonthCharges + outstandingPreviousDebt;


        setFormData(prev => ({
            ...prev,
            electricityUsage: electricityUsage,
            electricityCost: electricityCost,
            waterUsage: waterUsage,
            waterCost: waterCost,
            currentMonthCharges: currentMonthCharges,
            totalAmount: totalAmount,
            // remainingAmount and paymentStatus will be calculated in handleSaveEditedBill
        }));
    }, [formData.previousElectricityMeter, formData.currentElectricityMeter,
        formData.previousWaterMeter, formData.currentWaterMeter,
        formData.rentAmount, formData.otherFeesAmount, formData.outstandingPreviousDebt, serviceSettings]);


    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        await onSave(formData);
        setIsSaving(false);
    };

    return (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContentLarge}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>Chỉnh sửa Hóa đơn {formData.invoiceCode}</h3>
                    <button onClick={onCancel} style={styles.modalCloseButton}>&times;</button>
                </div>
                <form onSubmit={handleSubmit} style={styles.formGrid}>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Phòng:</label>
                        <input type="text" value={formData.roomNumber} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Người thuê:</label>
                        <input type="text" value={formData.tenantName} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Kỳ:</label>
                        <input type="text" value={`Tháng ${formData.billingMonth}/${formData.billingYear}`} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="rentAmount" style={styles.formLabel}>Tiền phòng tháng này (VNĐ):</label>
                        <input type="number" id="rentAmount" name="rentAmount" value={formData.rentAmount} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="previousElectricityMeter" style={styles.formLabel}>Chỉ số điện cũ:</label>
                        <input type="number" id="previousElectricityMeter" name="previousElectricityMeter" value={formData.previousElectricityMeter} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="currentElectricityMeter" style={styles.formLabel}>Chỉ số điện mới:</label>
                        <input type="number" id="currentElectricityMeter" name="currentElectricityMeter" value={formData.currentElectricityMeter} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Sử dụng điện (kWh):</label>
                        <input type="text" value={formData.electricityUsage} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Thành tiền điện (VNĐ):</label>
                        <input type="text" value={formData.electricityCost.toLocaleString('vi-VN')} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="previousWaterMeter" style={styles.formLabel}>Chỉ số nước cũ:</label>
                        <input type="number" id="previousWaterMeter" name="previousWaterMeter" value={formData.previousWaterMeter} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="currentWaterMeter" style={styles.formLabel}>Chỉ số nước mới:</label>
                        <input type="number" id="currentWaterMeter" name="currentWaterMeter" value={formData.currentWaterMeter} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Sử dụng nước (m³):</label>
                        <input type="text" value={formData.waterUsage} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Thành tiền nước (VNĐ):</label>
                        <input type="text" value={formData.waterCost.toLocaleString('vi-VN')} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Internet (VNĐ):</label>
                        <input type="text" value={formData.internetFee.toLocaleString('vi-VN')} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Rác (VNĐ):</label>
                        <input type="text" value={formData.trashFee.toLocaleString('vi-VN')} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="otherFeesDescription" style={styles.formLabel}>Mô tả phí khác:</label>
                        <input type="text" id="otherFeesDescription" name="otherFeesDescription" value={formData.otherFeesDescription} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="otherFeesAmount" style={styles.formLabel}>Số tiền phí khác (VNĐ):</label>
                        <input type="number" id="otherFeesAmount" name="otherFeesAmount" value={formData.otherFeesAmount} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Nợ cũ còn lại (VNĐ):</label>
                        <input type="text" value={formData.outstandingPreviousDebt.toLocaleString('vi-VN')} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Tổng cộng phải trả (VNĐ):</label>
                        <input type="text" value={formData.totalAmount.toLocaleString('vi-VN')} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="paidAmount" style={styles.formLabel}>Đã thanh toán (VNĐ):</label>
                        <input type="number" id="paidAmount" name="paidAmount" value={formData.paidAmount} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Còn lại (VNĐ):</label>
                        <input type="text" value={(formData.totalAmount - formData.paidAmount).toLocaleString('vi-VN')} style={styles.formInput} disabled />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="billDate" style={styles.formLabel}>Ngày tạo hóa đơn:</label>
                        <input type="date" id="billDate" name="billDate" value={formData.billDate} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>
                    <div style={styles.formGroup}>
                        <label htmlFor="paymentDate" style={styles.formLabel}>Ngày thanh toán:</label>
                        <input type="date" id="paymentDate" name="paymentDate" value={formData.paymentDate} onChange={handleChange} style={styles.formInput} disabled={isSaving} />
                    </div>

                    <div style={styles.formActions}>
                        <button type="button" onClick={onCancel} style={{...styles.button, ...styles.buttonSecondary}} disabled={isSaving}>
                            Hủy
                        </button>
                        <button type="submit" style={{...styles.button, ...styles.buttonPrimary}} disabled={isSaving}>
                            {isSaving ? 'Đang lưu...' : 'Lưu Hóa đơn'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// Component chính của ứng dụng
function App() {
    const { db, auth, userId, loadingFirebase, isAuthReady } = useContext(FirebaseContext);
    const [rooms, setRooms] = useState([]);
    const [serviceSettings, setServiceSettings] = useState(null);
    const [bills, setBills] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [currentPage, setCurrentPage] = useState('roomList');
    const [selectedRoom, setSelectedRoom] = useState(null);

    // State cho CustomModal
    const [modalState, setModalState] = useState({
        showModal: false,
        title: '',
        message: '',
        onConfirm: null,
        onCancel: null,
        showCancel: true,
    });

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [billToPay, setBillToPay] = useState(null);
    const [showBillDetailModal, setShowBillDetailModal] = useState(false);
    const [billToView, setBillToView] = useState(null);

    // New states for editing bills
    const [showBillEditForm, setShowBillEditForm] = useState(false);
    const [billToEdit, setBillToEdit] = useState(null);


    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // Hàm hiển thị modal thông báo
    const showInfoModal = useCallback((title, message, onConfirm = () => setModalState({ showModal: false }), showCancel = false) => {
        setModalState({
            showModal: true,
            title: title,
            message: message,
            onConfirm: onConfirm,
            onCancel: () => setModalState({ showModal: false }),
            showCancel: showCancel,
        });
    }, []);

    // Hàm hiển thị modal xác nhận
    const showConfirmModal = useCallback((title, message, onConfirmAction) => {
        setModalState({
            showModal: true,
            title: title,
            message: message,
            onConfirm: async () => {
                await onConfirmAction();
                setModalState({ showModal: false }); // Đóng modal sau khi hành động xác nhận hoàn tất
            },
            onCancel: () => setModalState({ showModal: false }),
            showCancel: true,
        });
    }, []);

    // Lắng nghe dữ liệu phòng từ Firestore
    useEffect(() => {
        // Only fetch data if db, userId are available AND auth state is ready
        if (!db || !userId || !isAuthReady) return;

        console.log("Fetching rooms for appId:", appId, "userId:", userId); // DEBUG LOG
        const roomsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/rooms`);
        const q = query(roomsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const roomsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            roomsData.sort((a, b) => {
                const roomA = parseInt(a.roomNumber.replace(/\D/g, ''), 10);
                const roomB = parseInt(b.roomNumber.replace(/\D/g, ''), 10);
                return roomA - roomB;
            });
            setRooms(roomsData);
        }, (error) => {
            console.error("Lỗi khi tải dữ liệu phòng:", error);
            showInfoModal("Lỗi", "Không thể tải dữ liệu phòng. Vui lòng thử lại.");
        });

        return () => unsubscribe();
    }, [db, userId, appId, showInfoModal, isAuthReady]); // Add isAuthReady to dependencies

    // Lắng nghe cài đặt dịch vụ từ Firestore
    useEffect(() => {
        // Only fetch data if db, userId are available AND auth state is ready
        if (!db || !userId || !isAuthReady) return;

        console.log("Fetching settings for appId:", appId, "userId:", userId); // DEBUG LOG
        const settingsDocRef = doc(db, `artifacts/${appId}/users/${userId}/serviceSettings`, 'settingsDoc');

        const unsubscribe = onSnapshot(settingsDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setServiceSettings(docSnap.data());
            } else {
                setServiceSettings({
                    electricityPrice: 3000,
                    waterPrice: 15000,
                    internetPrice: 100000,
                    trashPrice: 20000
                });
            }
        }, (error) => {
            console.error("Lỗi khi tải cài đặt dịch vụ:", error);
            showInfoModal("Lỗi", "Không thể tải cài đặt dịch vụ. Vui lòng thử lại.");
        });

        return () => unsubscribe();
    }, [db, userId, appId, showInfoModal, isAuthReady]); // Add isAuthReady to dependencies

    // Lắng nghe dữ liệu hóa đơn từ Firestore
    useEffect(() => {
        // Only fetch data if db, userId are available AND auth state is ready
        if (!db || !userId || !isAuthReady) return;

        console.log("Fetching bills for appId:", appId, "userId:", userId); // DEBUG LOG
        const billsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/bills`);
        const q = query(billsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const billsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            billsData.sort((a, b) => new Date(b.billDate) - new Date(a.billDate));
            setBills(billsData);
        }, (error) => {
            console.error("Lỗi khi tải dữ liệu hóa đơn:", error);
            showInfoModal("Lỗi", "Không thể tải dữ liệu hóa đơn. Vui lòng thử lại.");
        });

        return () => unsubscribe();
    }, [db, userId, appId, showInfoModal, isAuthReady]); // Add isAuthReady to dependencies

    // Lắng nghe dữ liệu chi phí từ Firestore
    useEffect(() => {
        // Only fetch data if db, userId are available AND auth state is ready
        if (!db || !userId || !isAuthReady) return;

        console.log("Fetching expenses for appId:", appId, "userId:", userId); // DEBUG LOG
        const expensesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/expenses`);
        const q = query(expensesCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const expensesData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            expensesData.sort((a, b) => new Date(b.date) - new Date(a.date));
            setExpenses(expensesData);
        }, (error) => {
            console.error("Lỗi khi tải dữ liệu chi phí:", error);
            showInfoModal("Lỗi", "Không thể tải dữ liệu chi phí. Vui lòng thử lại.");
        });

        return () => unsubscribe();
    }, [db, userId, appId, showInfoModal, isAuthReady]); // Add isAuthReady to dependencies

    // Hàm thêm/cập nhật phòng
    const handleSaveRoom = useCallback(async (roomData) => {
        if (!db || !userId) {
            showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            return;
        }

        try {
            const roomsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/rooms`);

            if (roomData.id) {
                const roomRef = doc(roomsCollectionRef, roomData.id);
                const { id, ...dataToUpdate } = roomData;
                await updateDoc(roomRef, dataToUpdate);
                showInfoModal("Thành công", "Thông tin phòng đã được cập nhật!", () => {
                    setModalState({ showModal: false });
                    setCurrentPage('roomList');
                    setSelectedRoom(null);
                });
            } else {
                const { id, ...dataToAdd } = roomData;
                await addDoc(roomsCollectionRef, dataToAdd);
                showInfoModal("Thành công", "Phòng mới đã được thêm!", () => {
                    setModalState({ showModal: false });
                    setCurrentPage('roomList');
                    setSelectedRoom(null);
                });
            }
        } catch (error) {
            console.error("Lỗi khi lưu phòng:", error);
            showInfoModal("Lỗi", `Không thể lưu phòng: ${error.message}`);
        }
    }, [db, userId, appId, showInfoModal]);

    // Hàm xóa phòng
    const handleDeleteRoom = useCallback((room) => {
        showConfirmModal(`Xác nhận xóa Phòng ${room.roomNumber}`, `Bạn có chắc chắn muốn xóa phòng "${room.roomNumber}" không?`, async () => {
            if (!db || !userId) {
                showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
                return;
            }
            try {
                const roomsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/rooms`);
                const roomRef = doc(roomsCollectionRef, room.id);
                await deleteDoc(roomRef);
                showInfoModal("Thành công", "Phòng đã được xóa.");
            } catch (error) {
                console.error("Lỗi khi xóa phòng:", error);
                showInfoModal("Lỗi", `Không thể xóa phòng: ${error.message}`);
            }
        });
    }, [db, userId, appId, showConfirmModal, showInfoModal]);

    // Hàm lưu cài đặt dịch vụ
    const handleSaveServiceSettings = useCallback(async (settingsData) => {
        if (!db || !userId) {
            showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            return;
        }
        try {
            const settingsDocRef = doc(db, `artifacts/${appId}/users/${userId}/serviceSettings`, 'settingsDoc');
            await setDoc(settingsDocRef, settingsData, { merge: true });
            showInfoModal("Thành công", "Cài đặt dịch vụ đã được cập nhật!");
        } catch (error) {
            console.error("Lỗi khi lưu cài đặt dịch vụ:", error);
            showInfoModal("Lỗi", `Không thể lưu cài đặt dịch vụ: ${error.message}`);
        }
    }, [db, userId, appId, showInfoModal]);

    // Hàm xử lý thanh toán hóa đơn (từ PaymentModal)
    const handleProcessPayment = useCallback(async (billId, roomId, paymentAmount) => {
        if (!db || !userId) {
            showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            return;
        }

        try {
            const billRef = doc(collection(db, `artifacts/${appId}/users/${userId}/bills`), billId);
            const roomRef = doc(collection(db, `artifacts/${appId}/users/${userId}/rooms`), roomId);

            const billSnap = await getDoc(billRef);
            const roomSnap = await getDoc(roomRef);

            if (!billSnap.exists() || !roomSnap.exists()) {
                showInfoModal("Lỗi", "Không tìm thấy hóa đơn hoặc phòng để cập nhật.");
                return;
            }

            const currentBillData = billSnap.data();
            const currentRoomData = roomSnap.data();

            let newPaidAmountForBill = (currentBillData.paidAmount || 0) + paymentAmount;
            let newRemainingAmountForBill = currentBillData.totalAmount - newPaidAmountForBill;
            let newPaymentStatus = 'Partially Paid';

            if (newRemainingAmountForBill <= 0) {
                newPaymentStatus = 'Paid';
                newRemainingAmountForBill = 0;
            }

            await updateDoc(billRef, {
                paidAmount: newPaidAmountForBill,
                remainingAmount: newRemainingAmountForBill,
                paymentStatus: newPaymentStatus,
                paymentDate: new Date().toISOString().split('T')[0]
            });

            const currentRoomDebt = currentRoomData.debtAmount || 0;
            const updatedRoomDebt = Math.max(0, currentRoomDebt - paymentAmount);

            await updateDoc(roomRef, {
                debtAmount: updatedRoomDebt,
                lastPaymentDate: new Date().toISOString().split('T')[0]
            });

            showInfoModal("Thành công", "Thanh toán đã được xử lý và thông tin đã được cập nhật.");
        } catch (error) {
            console.error("Lỗi khi xử lý thanh toán:", error);
            showInfoModal("Lỗi", `Không thể xử lý thanh toán: ${error.message}`);
        }
    }, [db, userId, appId, showInfoModal]);

    // Hàm thêm chi phí
    const handleAddExpense = useCallback(async (expenseData) => {
        if (!db || !userId) {
            showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            return;
        }
        try {
            const expensesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/expenses`);
            await addDoc(expensesCollectionRef, expenseData);
            showInfoModal("Thành công", "Chi phí đã được thêm!");
        } catch (error) {
                console.error("Lỗi khi thêm chi phí:", error);
            showInfoModal("Lỗi", `Không thể thêm chi phí: ${error.message}`);
        }
    }, [db, userId, appId, showInfoModal]);

    // Hàm xóa chi phí
    const handleDeleteExpense = useCallback((expenseId) => {
        showConfirmModal("Xác nhận xóa", "Bạn có chắc chắn muốn xóa chi phí này không?", async () => {
            if (!db || !userId) {
                showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
                return;
            }
            try {
                const expenseRef = doc(collection(db, `artifacts/${appId}/users/${userId}/expenses`), expenseId);
                await deleteDoc(expenseRef);
                showInfoModal("Thành công", "Chi phí đã được xóa.");
            } catch (error) {
                console.error("Lỗi khi xóa chi phí:", error);
                showInfoModal("Lỗi", `Không thể xóa chi phí: ${error.message}`);
            }
        });
    }, [db, userId, appId, showConfirmModal, showInfoModal]);

    const handleOpenPaymentModal = useCallback((bill) => {
        setBillToPay(bill);
        setShowPaymentModal(true);
    }, []);

    const handleClosePaymentModal = useCallback(() => {
        setShowPaymentModal(false);
        setBillToPay(null);
    }, []);

    const handleOpenBillDetailModal = useCallback((bill) => {
        setBillToView(bill);
        setShowBillDetailModal(true);
    }, []);

    const handleCloseBillDetailModal = useCallback(() => {
        setShowBillDetailModal(false);
        setBillToView(null);
    }, []);

    // New handlers for editing bills
    const handleOpenBillEditForm = useCallback((bill) => {
        setBillToEdit(bill);
        setShowBillEditForm(true);
        setShowBillDetailModal(false); // Close detail modal when opening edit form
    }, []);

    const handleCloseBillEditForm = useCallback(() => {
        setShowBillEditForm(false);
        setBillToEdit(null);
    }, []);

    const handleSaveEditedBill = useCallback(async (updatedBillData) => {
        if (!db || !userId) {
            showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            return;
        }
        try {
            const billRef = doc(collection(db, `artifacts/${appId}/users/${userId}/bills`), updatedBillData.id);
            // Calculate remainingAmount and paymentStatus based on updated data
            const newRemainingAmount = updatedBillData.totalAmount - updatedBillData.paidAmount;
            let newPaymentStatus = 'Partially Paid';
            if (newRemainingAmount <= 0) {
                newPaymentStatus = 'Paid';
            } else if (updatedBillData.paidAmount === 0) {
                newPaymentStatus = 'Unpaid';
            }

            await updateDoc(billRef, {
                ...updatedBillData,
                remainingAmount: Math.max(0, newRemainingAmount), // Ensure it's not negative
                paymentStatus: newPaymentStatus,
                // Only update paymentDate if it becomes fully paid or partially paid from unpaid
                paymentDate: newPaymentStatus !== 'Unpaid' && !updatedBillData.paymentDate && updatedBillData.paidAmount > 0 ? new Date().toISOString().split('T')[0] : updatedBillData.paymentDate
            });

            showInfoModal("Thành công", "Hóa đơn đã được cập nhật!", () => {
                setModalState({ showModal: false });
                handleCloseBillEditForm();
            });
        } catch (error) {
            console.error("Lỗi khi cập nhật hóa đơn:", error);
            showInfoModal("Lỗi", `Không thể cập nhật hóa đơn: ${error.message}`);
        }
    }, [db, userId, appId, showInfoModal, handleCloseBillEditForm]);


    // Redefine handleDeleteBill to include room debt adjustment
    const handleDeleteBill = useCallback((bill) => {
        showConfirmModal(`Xác nhận xóa Hóa đơn ${bill.invoiceCode}`, `Bạn có chắc chắn muốn xóa hóa đơn này không? Thao tác này sẽ không hoàn tác được và có thể ảnh hưởng đến tổng nợ của phòng.`, async () => {
            if (!db || !userId) {
                showInfoModal("Lỗi", "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
                return;
            }
            try {
                const billRef = doc(collection(db, `artifacts/${appId}/users/${userId}/bills`), bill.id);
                await deleteDoc(billRef);

                // Revert room debt if this bill contributed to it and was not fully paid
                if (bill.remainingAmount > 0) {
                    const roomRef = doc(collection(db, `artifacts/${appId}/users/${userId}/rooms`), bill.roomId);
                    const roomSnap = await getDoc(roomRef);
                    if (roomSnap.exists()) {
                        const currentRoomData = roomSnap.data();
                        // Subtract the remaining amount of the deleted bill from the room's total debt
                        const updatedRoomDebt = Math.max(0, (currentRoomData.debtAmount || 0) - bill.remainingAmount);
                        await updateDoc(roomRef, { debtAmount: updatedRoomDebt });
                    }
                }

                showInfoModal("Thành công", "Hóa đơn đã được xóa.");
            } catch (error) {
                console.error("Lỗi khi xóa hóa đơn:", error);
                showInfoModal("Lỗi", `Không thể xóa hóa đơn: ${error.message}`);
            }
        });
    }, [db, userId, appId, showConfirmModal, showInfoModal]);


    if (loadingFirebase || !isAuthReady) { // Wait for Firebase to be initialized and auth state to be ready
        return (
            <div style={styles.loadingContainer}>
                <div style={styles.loadingText}>Đang tải ứng dụng...</div>
            </div>
        );
    }

    if (!userId) {
        return (
            <LoginScreen
                auth={auth}
                setModalState={setModalState}
            />
        );
    }

    return (
        <div style={styles.appContainer}>
            <CustomModal
                showModal={modalState.showModal}
                title={modalState.title}
                message={modalState.message}
                onConfirm={modalState.onConfirm}
                onCancel={modalState.onCancel}
                showCancel={modalState.showCancel}
            />
            {showPaymentModal && billToPay && (
                <PaymentModal
                    bill={billToPay}
                    onClose={handleClosePaymentModal}
                    onProcessPayment={handleProcessPayment}
                    setModalState={setModalState}
                />
            )}
            {showBillDetailModal && billToView && (
                <BillDetailModal
                    bill={billToView}
                    onClose={handleCloseBillDetailModal}
                    onEdit={handleOpenBillEditForm} // Pass the new handler
                    onDelete={handleDeleteBill} // Pass the delete handler
                />
            )}
            {showBillEditForm && billToEdit && (
                <BillEditForm
                    bill={billToEdit}
                    onSave={handleSaveEditedBill}
                    onCancel={handleCloseBillEditForm}
                    rooms={rooms} // Pass rooms for room number display if needed
                    serviceSettings={serviceSettings} // Pass settings if any service prices are editable
                />
            )}

            <header style={styles.header}>
                <div style={styles.container}>
                    <h1 style={styles.headerTitle}>QUẢN LÝ PHÒNG TRỌ - ÔNG BẢY TUẤN</h1>
                    <div style={{display: 'flex', alignItems: 'center', flexWrap: 'wrap'}}>
                        <span style={styles.userIdText}>User ID: <span style={{fontWeight: 'bold'}}>{userId}</span></span>
                        <button
                            onClick={() => signOut(auth)}
                            style={styles.logoutButton}
                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = styles.logoutButtonHover.backgroundColor}
                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = styles.logoutButton.backgroundColor}
                        >
                            Đăng xuất
                        </button>
                    </div>
                </div>
            </header>

            <nav style={styles.nav}>
                <div style={styles.navContainer}>
                    <button
                        onClick={() => { setCurrentPage('roomList'); setSelectedRoom(null); }}
                        style={{...styles.navButton, ...(currentPage === 'roomList' ? styles.navButtonActive : {})}}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'roomList' ? styles.navButtonActive.backgroundColor : styles.navButtonHover.backgroundColor)}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'roomList' ? styles.navButtonActive.backgroundColor : styles.navButton.backgroundColor)}
                    >
                        Danh sách Phòng
                    </button>
                    <button
                        onClick={() => { setCurrentPage('addRoom'); setSelectedRoom(null); }}
                        style={{...styles.navButton, ...(currentPage === 'addRoom' ? styles.navButtonActive : {})}}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'addRoom' ? styles.navButtonActive.backgroundColor : styles.navButtonHover.backgroundColor)}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'addRoom' ? styles.navButtonActive.backgroundColor : styles.navButton.backgroundColor)}
                    >
                        Thêm Phòng Mới
                    </button>
                    <button
                        onClick={() => { setCurrentPage('serviceSettings'); setSelectedRoom(null); }}
                        style={{...styles.navButton, ...(currentPage === 'serviceSettings' ? styles.navButtonActive : {})}}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'serviceSettings' ? styles.navButtonActive.backgroundColor : styles.navButtonHover.backgroundColor)}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'serviceSettings' ? styles.navButtonActive.backgroundColor : styles.navButton.backgroundColor)}
                    >
                        Cài đặt Dịch vụ
                    </button>
                    <button
                        onClick={() => { setCurrentPage('billGenerator'); setSelectedRoom(null); }}
                        style={{...styles.navButton, ...(currentPage === 'billGenerator' ? styles.navButtonActive : {})}}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'billGenerator' ? styles.navButtonActive.backgroundColor : styles.navButtonHover.backgroundColor)}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'billGenerator' ? styles.navButtonActive.backgroundColor : styles.navButton.backgroundColor)}
                    >
                        Tính Tiền Phòng
                    </button>
                    <button
                        onClick={() => { setCurrentPage('billHistory'); setSelectedRoom(null); }}
                        style={{...styles.navButton, ...(currentPage === 'billHistory' ? styles.navButtonActive : {})}}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'billHistory' ? styles.navButtonActive.backgroundColor : styles.navButtonHover.backgroundColor)}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'billHistory' ? styles.navButtonActive.backgroundColor : styles.navButton.backgroundColor)}
                    >
                        Lịch sử Hóa đơn
                    </button>
                    <button
                        onClick={() => { setCurrentPage('expenseManagement'); setSelectedRoom(null); }}
                        style={{...styles.navButton, ...(currentPage === 'expenseManagement' ? styles.navButtonActive : {})}}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'expenseManagement' ? styles.navButtonActive.backgroundColor : styles.navButtonHover.backgroundColor)}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'expenseManagement' ? styles.navButtonActive.backgroundColor : styles.navButton.backgroundColor)}
                    >
                        Quản lý Chi phí
                    </button>
                    <button
                        onClick={() => { setCurrentPage('financialOverview'); setSelectedRoom(null); }}
                        style={{...styles.navButton, ...(currentPage === 'financialOverview' ? styles.navButtonActive : {})}}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'financialOverview' ? styles.navButtonActive.backgroundColor : styles.navButtonHover.backgroundColor)}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = (currentPage === 'financialOverview' ? styles.navButtonActive.backgroundColor : styles.navButton.backgroundColor)}
                    >
                        Tổng quan Tài chính
                    </button>
                </div>
            </nav>

            <main style={{...styles.mainContent, ...styles.container}}>
                {currentPage === 'roomList' && (
                    <RoomList
                        rooms={rooms}
                        onViewRoom={(room) => { setSelectedRoom(room); setCurrentPage('roomDetail'); }}
                        onEditRoom={(room) => { setSelectedRoom(room); setCurrentPage('editRoom'); }}
                        onDeleteRoom={handleDeleteRoom}
                    />
                )}
                {currentPage === 'addRoom' && (
                    <RoomForm
                        onSave={handleSaveRoom}
                        onCancel={() => setCurrentPage('roomList')}
                    />
                )}
                {currentPage === 'editRoom' && selectedRoom && (
                    <RoomForm
                        room={selectedRoom}
                        onSave={handleSaveRoom}
                        onCancel={() => setCurrentPage('roomList')}
                    />
                )}
                {currentPage === 'roomDetail' && selectedRoom && (
                    <RoomDetailModal
                        room={selectedRoom}
                        onClose={() => { setCurrentPage('roomList'); setSelectedRoom(null); }}
                        onEdit={handleOpenBillEditForm} // Pass the new handler
                        onDelete={handleDeleteBill} // Pass the delete handler
                    />
                )}
                {currentPage === 'serviceSettings' && serviceSettings && (
                    <ServiceSettingsForm
                        settings={serviceSettings}
                        onSave={handleSaveServiceSettings}
                    />
                )}
                {currentPage === 'billGenerator' && (
                    <BillGenerator
                        rooms={rooms}
                        serviceSettings={serviceSettings}
                        db={db}
                        userId={userId}
                        appId={appId}
                        setModalState={setModalState}
                    />
                )}
                {currentPage === 'billHistory' && (
                    <BillHistory
                        bills={bills}
                        rooms={rooms}
                        onOpenPaymentModal={handleOpenPaymentModal}
                        onOpenBillDetailModal={handleOpenBillDetailModal}
                        setModalState={setModalState}
                    />
                )}
                {currentPage === 'expenseManagement' && (
                    <ExpenseManagement
                        expenses={expenses}
                        onAddExpense={handleAddExpense}
                        onDeleteExpense={handleDeleteExpense}
                        setModalState={setModalState}
                    />
                )}
                {currentPage === 'financialOverview' && (
                    <FinancialOverview
                        bills={bills}
                        expenses={expenses}
                    />
                )}
            </main>

            <footer style={styles.footer}>
                &copy; 2025 - Ứng dụng Quản lý Phòng Trọ by Trí Thành - version: 1.05.2025
            </footer>
        </div>
    );
}

// Component Danh sách Phòng
const RoomList = ({ rooms, onViewRoom, onEditRoom, onDeleteRoom }) => {
    return (
        <div style={styles.card}>
            <h2 style={styles.cardTitle}>Danh sách Phòng</h2>
            {rooms.length === 0 ? (
                <p style={styles.noDataText}>Chưa có phòng nào được thêm. Hãy thêm một phòng mới!</p>
            ) : (
                <div style={styles.roomGrid}>
                    {rooms.map(room => (
                        <div key={room.id} style={styles.roomCard}
                            onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'}
                            onMouseOut={(e) => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'}
                        >
                            <h3 style={styles.roomCardTitle}>Phòng {room.roomNumber}</h3>
                            <p style={{fontSize: '0.9em', color: '#333'}}><strong>Trạng thái:</strong> <span style={
                                room.status === 'Occupied' ? styles.roomStatusOccupied :
                                room.status === 'Vacant' ? styles.roomStatusVacant :
                                styles.roomStatusMaintenance
                            }>{room.status === 'Occupied' ? 'Đang thuê' : room.status === 'Vacant' ? 'Trống' : 'Bảo trì'}</span></p>
                            {room.tenantName && <p style={{fontSize: '0.9em', color: '#333'}}><strong>Người thuê:</strong> {room.tenantName}</p>}
                            {room.rentAmount && <p style={{fontSize: '0.9em', color: '#333'}}><strong>Giá thuê:</strong> {parseInt(room.rentAmount).toLocaleString('vi-VN')} VNĐ</p>}
                            {room.debtAmount > 0 && <p style={{...styles.roomDebt, fontSize: '0.9em'}}><strong>Nợ:</strong> {parseInt(room.debtAmount).toLocaleString('vi-VN')} VNĐ</p>}
                            <div style={styles.formActionsRight}>
                                <button
                                    onClick={() => onViewRoom(room)}
                                    style={{...styles.button, backgroundColor: '#2196F3', fontSize: '0.8em', padding: '5px 10px'}}
                                >
                                    Chi tiết
                                </button>
                                <button
                                    onClick={() => onEditRoom(room)}
                                    style={{...styles.button, backgroundColor: 'orange', fontSize: '0.8em', padding: '5px 10px'}}
                                >
                                    Sửa
                                </button>
                                <button
                                    onClick={() => onDeleteRoom(room)}
                                    style={{...styles.button, backgroundColor: 'red', fontSize: '0.8em', padding: '5px 10px'}}
                                >
                                    Xóa
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Component Form thêm/chỉnh sửa phòng
const RoomForm = ({ room, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        id: '',
        roomNumber: '',
        tenantName: '',
        idCard: '',
        address: '',
        hometown: '',
        phoneNumber: '',
        rentAmount: '',
        deposit: '',
        status: 'Vacant',
        startDate: '',
        previousElectricityMeter: '',
        currentElectricityMeter: '',
        previousWaterMeter: '',
        currentWaterMeter: '',
        debtAmount: 0,
        debtDescription: '',
        dueDate: '',
        lastPaymentDate: '',
        condition: 'Tốt',
        repairNotes: '',
        meterHistory: [],
        notes: ''
    });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (room) {
            setFormData({
                id: room.id || '',
                roomNumber: room.roomNumber || '',
                tenantName: room.tenantName || '',
                idCard: room.idCard || '',
                address: room.address || '',
                hometown: room.hometown || '',
                phoneNumber: room.phoneNumber || '',
                rentAmount: room.rentAmount || '',
                deposit: room.deposit || '',
                status: room.status || 'Vacant',
                startDate: room.startDate || '',
                previousElectricityMeter: room.previousElectricityMeter || '',
                currentElectricityMeter: room.currentElectricityMeter || '',
                previousWaterMeter: room.previousWaterMeter || '',
                currentWaterMeter: room.currentWaterMeter || '',
                debtAmount: room.debtAmount || 0,
                debtDescription: room.debtDescription || '',
                dueDate: room.dueDate || '',
                lastPaymentDate: room.lastPaymentDate || '',
                condition: room.condition || 'Tốt',
                repairNotes: room.repairNotes || '',
                meterHistory: room.meterHistory || [],
                notes: room.notes || ''
            });
        }
    }, [room]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        await onSave(formData);
        setIsSaving(false);
    };

    return (
        <div style={styles.card}>
            <h2 style={styles.cardTitle}>{room ? 'Chỉnh sửa Phòng' : 'Thêm Phòng Mới'}</h2>
            <form onSubmit={handleSubmit} style={styles.formGrid}>
                <div style={styles.formGroup}>
                    <label htmlFor="roomNumber" style={styles.formLabel}>Số phòng <span style={{color: 'red'}}>*</span></label>
                    <input
                        type="text"
                        id="roomNumber"
                        name="roomNumber"
                        value={formData.roomNumber}
                        onChange={handleChange}
                        required
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="status" style={styles.formLabel}>Trạng thái <span style={{color: 'red'}}>*</span></label>
                    <select
                        id="status"
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                        required
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    >
                        <option value="Vacant">Trống</option>
                        <option value="Occupied">Đang thuê</option>
                        <option value="Maintenance">Bảo trì</option>
                    </select>
                </div>
                {formData.status === 'Occupied' && (
                    <>
                        <div style={styles.formGroup}>
                            <label htmlFor="tenantName" style={styles.formLabel}>Tên người thuê</label>
                            <input
                                type="text"
                                id="tenantName"
                                name="tenantName"
                                value={formData.tenantName}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="idCard" style={styles.formLabel}>Số CMND/CCCD</label>
                            <input
                                type="text"
                                id="idCard"
                                name="idCard"
                                value={formData.idCard}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="address" style={styles.formLabel}>Địa chỉ</label>
                            <input
                                type="text"
                                id="address"
                                name="address"
                                value={formData.address}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="hometown" style={styles.formLabel}>Quê quán</label>
                            <input
                                type="text"
                                id="hometown"
                                name="hometown"
                                value={formData.hometown}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="phoneNumber" style={styles.formLabel}>Số điện thoại</label>
                            <input
                                type="text"
                                id="phoneNumber"
                                name="phoneNumber"
                                value={formData.phoneNumber}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="rentAmount" style={styles.formLabel}>Giá thuê (VNĐ)</label>
                            <input
                                type="number"
                                id="rentAmount"
                                name="rentAmount"
                                value={formData.rentAmount}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="deposit" style={styles.formLabel}>Tiền đặt cọc (VNĐ)</label>
                            <input
                                type="number"
                                id="deposit"
                                name="deposit"
                                value={formData.deposit}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="startDate" style={styles.formLabel}>Ngày bắt đầu thuê</label>
                            <input
                                type="date"
                                id="startDate"
                                name="startDate"
                                value={formData.startDate}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="dueDate" style={styles.formLabel}>Ngày đến hạn trả tiền (ngày trong tháng)</label>
                            <input
                                type="number"
                                id="dueDate"
                                name="dueDate"
                                value={formData.dueDate}
                                onChange={handleChange}
                                min="1"
                                max="31"
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="lastPaymentDate" style={styles.formLabel}>Ngày thanh toán gần nhất</label>
                            <input
                                type="date"
                                id="lastPaymentDate"
                                name="lastPaymentDate"
                                value={formData.lastPaymentDate}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="previousElectricityMeter" style={styles.formLabel}>Chỉ số điện cũ (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="previousElectricityMeter"
                                name="previousElectricityMeter"
                                value={formData.previousElectricityMeter}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="currentElectricityMeter" style={styles.formLabel}>Chỉ số điện mới (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="currentElectricityMeter"
                                name="currentElectricityMeter"
                                value={formData.currentElectricityMeter}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="previousWaterMeter" style={styles.formLabel}>Chỉ số nước cũ (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="previousWaterMeter"
                                name="previousWaterMeter"
                                value={formData.previousWaterMeter}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="currentWaterMeter" style={styles.formLabel}>Chỉ số nước mới (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="currentWaterMeter"
                                name="currentWaterMeter"
                                value={formData.currentWaterMeter}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="debtAmount" style={styles.formLabel}>Số tiền nợ (VNĐ)</label>
                            <input
                                type="number"
                                id="debtAmount"
                                name="debtAmount"
                                value={formData.debtAmount}
                                onChange={handleChange}
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="debtDescription" style={styles.formLabel}>Mô tả nợ</label>
                            <textarea
                                id="debtDescription"
                                name="debtDescription"
                                value={formData.debtDescription}
                                onChange={handleChange}
                                rows="2"
                                style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                                disabled={isSaving}
                            ></textarea>
                        </div>
                    </>
                )}
                <div style={styles.formGroup}>
                    <label htmlFor="condition" style={styles.formLabel}>Tình trạng phòng</label>
                    <select
                        id="condition"
                        name="condition"
                        value={formData.condition}
                        onChange={handleChange}
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    >
                        <option value="Tốt">Tốt</option>
                        <option value="Cần sửa chữa">Cần sửa chữa</option>
                        <option value="Đang sửa chữa">Đang sửa chữa</option>
                    </select>
                </div>
                {formData.condition !== 'Tốt' && (
                    <div style={styles.formGroup}>
                        <label htmlFor="repairNotes" style={styles.formLabel}>Ghi chú sửa chữa</label>
                        <textarea
                            id="repairNotes"
                            name="repairNotes"
                            value={formData.repairNotes}
                            onChange={handleChange}
                            rows="2"
                            style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                            disabled={isSaving}
                        ></textarea>
                    </div>
                )}
                <div style={styles.formGroup}>
                    <label htmlFor="notes" style={styles.formLabel}>Ghi chú chung</label>
                    <textarea
                        id="notes"
                        name="notes"
                        value={formData.notes}
                        onChange={handleChange}
                        rows="3"
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    ></textarea>
                </div>
                <div style={styles.formActions}>
                    <button
                        type="button"
                        onClick={onCancel}
                        style={isSaving ? {...styles.button, ...styles.buttonSecondary, ...styles.buttonDisabled} : {...styles.button, ...styles.buttonSecondary}}
                        disabled={isSaving}
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        style={isSaving ? {...styles.button, ...styles.buttonPrimary, ...styles.buttonDisabled} : {...styles.button, ...styles.buttonPrimary}}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Đang lưu...' : (room ? 'Cập nhật' : 'Thêm Phòng')}
                    </button>
                </div>
            </form>
        </div>
    );
};

// Component Cài đặt Dịch vụ
const ServiceSettingsForm = ({ settings, onSave }) => {
    const [formData, setFormData] = useState(settings);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setFormData(settings);
    }, [settings]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        await onSave(formData);
        setIsSaving(false);
    };

    return (
        <div style={styles.card}>
            <h2 style={styles.cardTitle}>Cài đặt Dịch vụ</h2>
            <form onSubmit={handleSubmit} style={styles.formGrid}>
                <div style={styles.formGroup}>
                    <label htmlFor="electricityPrice" style={styles.formLabel}>Giá điện (VNĐ/kWh)</label>
                    <input
                        type="number"
                        id="electricityPrice"
                        name="electricityPrice"
                        value={formData.electricityPrice}
                        onChange={handleChange}
                        required
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="waterPrice" style={styles.formLabel}>Giá nước (VNĐ/m³)</label>
                    <input
                        type="number"
                        id="waterPrice"
                        name="waterPrice"
                        value={formData.waterPrice}
                        onChange={handleChange}
                        required
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="internetPrice" style={styles.formLabel}>Giá Internet (VNĐ/tháng)</label>
                    <input
                        type="number"
                        id="internetPrice"
                        name="internetPrice"
                        value={formData.internetPrice}
                        onChange={handleChange}
                        required
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="trashPrice" style={styles.formLabel}>Giá rác (VNĐ/tháng)</label>
                    <input
                        type="number"
                        id="trashPrice"
                        name="trashPrice"
                        value={formData.trashPrice}
                        onChange={handleChange}
                        required
                        style={isSaving ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isSaving}
                    />
                </div>
                <div style={styles.formActionsRight}>
                    <button
                        type="submit"
                        style={isSaving ? {...styles.button, ...styles.buttonPrimary, ...styles.buttonDisabled} : {...styles.button, ...styles.buttonPrimary}}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Đang lưu...' : 'Lưu Cài đặt'}
                    </button>
                </div>
            </form>
        </div>
    );
};

// Component Tính Tiền Phòng
const BillGenerator = ({ rooms, serviceSettings, db, userId, appId, setModalState }) => {
    const [selectedRoomId, setSelectedRoomId] = useState('');
    const [billingMonth, setBillingMonth] = useState(new Date().getMonth() + 1);
    const [billingYear, setBillingYear] = useState(new Date().getFullYear());
    const [calculatedBill, setCalculatedBill] = useState(null);
    const [otherFeesDescription, setOtherFeesDescription] = useState('');
    const [otherFeesAmount, setOtherFeesAmount] = useState(0);
    const [currentRoomData, setCurrentRoomData] = useState(null);
    const [tempElectricityMeter, setTempElectricityMeter] = useState({ previous: '', current: '' });
    const [tempWaterMeter, setTempWaterMeter] = useState({ previous: '', current: '' });
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSavingBill, setIsSavingBill] = useState(false);


    useEffect(() => {
        if (selectedRoomId) {
            const room = rooms.find(r => r.id === selectedRoomId);
            if (room) {
                setCurrentRoomData(room);
                setTempElectricityMeter({
                    previous: room.previousElectricityMeter || '',
                    current: room.currentElectricityMeter || ''
                });
                setTempWaterMeter({
                    previous: room.previousWaterMeter || '',
                    current: room.currentWaterMeter || ''
                });
            }
        } else {
            setCurrentRoomData(null);
            setTempElectricityMeter({ previous: '', current: '' });
            setTempWaterMeter({ previous: '', current: '' });
        }
    }, [selectedRoomId, rooms]);


    const handleGenerateBill = async () => {
        setIsGenerating(true);
        if (!selectedRoomId || !serviceSettings || !currentRoomData) {
            setModalState({
                title: "Lỗi",
                message: "Vui lòng chọn phòng và đảm bảo cài đặt dịch vụ đã được tải.",
                showCancel: false,
                onConfirm: () => setModalState({ showModal: false }),
                showModal: true
            });
            setIsGenerating(false);
            return;
        }

        const electricityUsage = (parseFloat(tempElectricityMeter.current) || 0) - (parseFloat(tempElectricityMeter.previous) || 0);
        const electricityCost = electricityUsage > 0 ? electricityUsage * serviceSettings.electricityPrice : 0;

        const waterUsage = (parseFloat(tempWaterMeter.current) || 0) - (parseFloat(tempWaterMeter.previous) || 0);
        const waterCost = waterUsage > 0 ? waterUsage * serviceSettings.waterPrice : 0;

        const rentAmount = parseInt(currentRoomData.rentAmount) || 0;
        const internetFee = parseInt(serviceSettings.internetPrice) || 0;
        const trashFee = parseInt(serviceSettings.trashPrice) || 0;
        const otherFees = parseInt(otherFeesAmount) || 0;

        const currentMonthCharges =
            rentAmount +
            electricityCost +
            waterCost +
            internetFee +
            trashFee +
            otherFees;

        const outstandingPreviousDebt = parseInt(currentRoomData.debtAmount) || 0;

        const totalAmount = currentMonthCharges + outstandingPreviousDebt;

        const billDate = new Date().toISOString().split('T')[0];
        const invoiceCode = `${currentRoomData.roomNumber}-${formatInvoiceDate(billDate)}`;

        setCalculatedBill({
            roomId: currentRoomData.id,
            roomNumber: currentRoomData.roomNumber,
            tenantName: currentRoomData.tenantName,
            billingMonth: billingMonth,
            billingYear: billingYear,
            rentAmount: rentAmount,
            previousElectricityMeter: parseFloat(tempElectricityMeter.previous) || 0,
            currentElectricityMeter: parseFloat(tempElectricityMeter.current) || 0,
            electricityUsage: electricityUsage,
            electricityCost: electricityCost,
            previousWaterMeter: parseFloat(tempWaterMeter.previous) || 0,
            currentWaterMeter: parseFloat(tempWaterMeter.current) || 0,
            waterUsage: waterUsage,
            waterCost: waterCost,
            internetFee: internetFee,
            trashFee: trashFee,
            otherFeesDescription: otherFeesDescription,
            otherFeesAmount: otherFees,
            currentMonthCharges: currentMonthCharges,
            outstandingPreviousDebt: outstandingPreviousDebt,
            totalAmount: totalAmount,
            paymentStatus: 'Unpaid',
            paidAmount: 0,
            remainingAmount: totalAmount,
            billDate: billDate,
            invoiceCode: invoiceCode
        });
        setIsGenerating(false);
    };

    const handleSaveBill = async () => {
        setIsSavingBill(true);
        if (!calculatedBill) {
            setModalState({
                title: "Lỗi",
                message: "Chưa có hóa đơn để lưu.",
                showCancel: false,
                onConfirm: () => setModalState({ showModal: false }),
                showModal: true
            });
            setIsSavingBill(false);
            return;
        }

        if (!db || !userId) {
            setModalState({
                title: "Lỗi",
                message: "Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.",
                showCancel: false,
                onConfirm: () => setModalState({ showModal: false }),
                showModal: true
            });
            setIsSavingBill(false);
            return;
        }

        try {
            const billsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/bills`);
            await addDoc(billsCollectionRef, calculatedBill);

            const roomRef = doc(collection(db, `artifacts/${appId}/users/${userId}/rooms`), calculatedBill.roomId);

            const roomSnap = await getDoc(roomRef);
            const existingRoomData = roomSnap.data();
            let updatedMeterHistory = existingRoomData.meterHistory || [];

            updatedMeterHistory.unshift({
                month: `${calculatedBill.billingMonth}/${calculatedBill.billingYear}`,
                electricityOld: calculatedBill.previousElectricityMeter,
                electricityNew: calculatedBill.currentElectricityMeter,
                waterOld: calculatedBill.previousWaterMeter,
                waterNew: calculatedBill.currentWaterMeter,
            });

            if (updatedMeterHistory.length > 3) {
                updatedMeterHistory = updatedMeterHistory.slice(0, 3);
            }

            await updateDoc(roomRef, {
                previousElectricityMeter: calculatedBill.currentElectricityMeter,
                currentElectricityMeter: 0,
                previousWaterMeter: calculatedBill.currentWaterMeter,
                currentWaterMeter: 0,
                debtAmount: calculatedBill.totalAmount,
                debtDescription: calculatedBill.otherFeesDescription || '',
                meterHistory: updatedMeterHistory
            });

            // Close the success modal directly after successful save and room update
            setModalState({
                title: "Thành công",
                message: "Hóa đơn đã được lưu và chỉ số điện nước của phòng đã được cập nhật cho kỳ tiếp theo!",
                showCancel: false,
                onConfirm: () => { // This will now actually close the modal
                    setModalState({ showModal: false });
                    setCalculatedBill(null);
                    setOtherFeesDescription('');
                    setOtherFeesAmount(0);
                    setSelectedRoomId('');
                },
                showModal: true
            });
        } catch (error) {
            console.error("Lỗi khi lưu hóa đơn:", error);
            setModalState({
                title: "Lỗi",
                message: `Không thể lưu hóa đơn: ${error.message}`,
                showCancel: false,
                onConfirm: () => setModalState({ showModal: false }),
                showModal: true
            });
        } finally {
            setIsSavingBill(false);
        }
    };

    return (
        <div style={styles.card}>
            <h2 style={styles.cardTitle}>Tính Tiền Phòng</h2>
            <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                    <label htmlFor="selectRoom" style={styles.formLabel}>Chọn Phòng</label>
                    <select
                        id="selectRoom"
                        value={selectedRoomId}
                        onChange={(e) => setSelectedRoomId(e.target.value)}
                        style={styles.formInput}
                        disabled={isGenerating || isSavingBill}
                    >
                        <option value="">-- Chọn phòng --</option>
                        {rooms.map(room => (
                            <option key={room.id} value={room.id}>Phòng {room.roomNumber} ({room.tenantName || 'Trống'})</option>
                        ))}
                    </select>
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="billingMonth" style={styles.formLabel}>Tháng</label>
                    <input
                        type="number"
                        id="billingMonth"
                        value={billingMonth}
                        onChange={(e) => setBillingMonth(parseInt(e.target.value))}
                        min="1"
                        max="12"
                        style={styles.formInput}
                        disabled={isGenerating || isSavingBill}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="billingYear" style={styles.formLabel}>Năm</label>
                    <input
                        type="number"
                        id="billingYear"
                        value={billingYear}
                        onChange={(e) => setBillingYear(parseInt(e.target.value))}
                        min="2000"
                        style={styles.formInput}
                        disabled={isGenerating || isSavingBill}
                    />
                </div>
            </div>

            {currentRoomData && (
                <div style={styles.infoBox}>
                    <h3 style={styles.infoBoxTitle}>Thông tin Phòng {currentRoomData.roomNumber}</h3>
                    <div style={styles.infoBoxContent}>
                        <p><strong>Người thuê:</strong> {currentRoomData.tenantName || 'N/A'}</p>
                        <p><strong>Giá thuê:</strong> {parseInt(currentRoomData.rentAmount).toLocaleString('vi-VN')} VNĐ</p>
                        <p><strong>Số điện thoại:</strong> {currentRoomData.phoneNumber || 'N/A'}</p>
                        <p><strong>Ngày đến hạn:</strong> ngày {currentRoomData.dueDate || 'N/A'} hàng tháng</p>
                        <p style={{color: 'red', fontWeight: 'bold'}}><strong>Nợ hiện tại:</strong> {parseInt(currentRoomData.debtAmount).toLocaleString('vi-VN')} VNĐ</p>
                        <p><strong>Mô tả nợ:</strong> {currentRoomData.debtDescription || 'Không có'}</p>
                    </div>
                    <div style={styles.formGrid}>
                        <div style={styles.formGroup}>
                            <label htmlFor="tempPreviousElectricityMeter" style={styles.formLabel}>Chỉ số điện cũ</label>
                            <input
                                type="number"
                                id="tempPreviousElectricityMeter"
                                value={tempElectricityMeter.previous}
                                onChange={(e) => setTempElectricityMeter(prev => ({ ...prev, previous: e.target.value }))}
                                style={styles.formInput}
                                disabled={isGenerating || isSavingBill}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="tempCurrentElectricityMeter" style={styles.formLabel}>Chỉ số điện mới</label>
                            <input
                                type="number"
                                id="tempCurrentElectricityMeter"
                                value={tempElectricityMeter.current}
                                onChange={(e) => setTempElectricityMeter(prev => ({ ...prev, current: e.target.value }))}
                                style={styles.formInput}
                                disabled={isGenerating || isSavingBill}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="tempPreviousWaterMeter" style={styles.formLabel}>Chỉ số nước cũ</label>
                            <input
                                type="number"
                                id="tempPreviousWaterMeter"
                                value={tempWaterMeter.previous}
                                onChange={(e) => setTempWaterMeter(prev => ({ ...prev, previous: e.target.value }))}
                                style={styles.formInput}
                                disabled={isGenerating || isSavingBill}
                            />
                        </div>
                        <div style={styles.formGroup}>
                            <label htmlFor="tempCurrentWaterMeter" style={styles.formLabel}>Chỉ số nước mới</label>
                            <input
                                type="number"
                                id="tempCurrentWaterMeter"
                                value={tempWaterMeter.current}
                                onChange={(e) => setTempElectricityMeter(prev => ({ ...prev, current: e.target.value }))}
                                style={styles.formInput}
                                disabled={isGenerating || isSavingBill}
                            />
                        </div>
                    </div>
                    {currentRoomData.meterHistory && currentRoomData.meterHistory.length > 0 && (
                        <div style={styles.historyBox}>
                            <h4 style={styles.historyBoxTitle}>Lịch sử chỉ số 3 tháng gần nhất:</h4>
                            {currentRoomData.meterHistory.map((entry, index) => (
                                <div key={index} style={styles.historyEntry}>
                                    <p><strong>Kỳ:</strong> Tháng {entry.month}</p>
                                    <p>Điện: Cũ {entry.electricityOld} - Mới {entry.electricityNew}</p>
                                    <p>Nước: Cũ {entry.waterOld} - Mới {entry.waterNew}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div style={styles.formGroup}>
                <label htmlFor="otherFeesDescription" style={styles.formLabel}>Mô tả phí khác (nếu có)</label>
                <input
                    type="text"
                    id="otherFeesDescription"
                    value={otherFeesDescription}
                    onChange={(e) => setOtherFeesDescription(e.target.value)}
                    style={styles.formInput}
                    disabled={isGenerating || isSavingBill}
                />
            </div>
            <div style={styles.formGroup}>
                <label htmlFor="otherFeesAmount" style={styles.formLabel}>Số tiền phí khác (VNĐ)</label>
                <input
                    type="number"
                    id="otherFeesAmount"
                    value={otherFeesAmount}
                    onChange={(e) => setOtherFeesAmount(parseFloat(e.target.value) || 0)}
                    style={styles.formInput}
                    disabled={isGenerating || isSavingBill}
                />
            </div>

            <div style={styles.formActionsRight}>
                <button
                    onClick={handleGenerateBill}
                    style={{...styles.button, ...styles.buttonSuccess}}
                    disabled={isGenerating || isSavingBill}
                >
                    {isGenerating ? 'Đang tạo...' : 'Tạo Hóa đơn'}
                </button>
            </div>

            {calculatedBill && (
                <div style={styles.billPreview}>
                    <h3 style={styles.billPreviewTitle}>Hóa đơn Tiền Phòng - Tháng {calculatedBill.billingMonth}/{calculatedBill.billingYear}</h3>
                    <div style={styles.infoBoxContent}>
                        <p><strong>Phòng:</strong> {calculatedBill.roomNumber}</p>
                        <p><strong>Người thuê:</strong> {calculatedBill.tenantName}</p>
                        <p><strong>Tiền phòng tháng này:</strong> {calculatedBill.rentAmount.toLocaleString('vi-VN')} VNĐ</p>
                        <div>
                            <p><strong>Điện:</strong></p>
                            <ul style={styles.list}>
                                <li>Chỉ số cũ: {calculatedBill.previousElectricityMeter}</li>
                                <li>Chỉ số mới: {calculatedBill.currentElectricityMeter}</li>
                                <li>Sử dụng: {calculatedBill.electricityUsage} kWh</li>
                                <li>Thành tiền: {calculatedBill.electricityCost.toLocaleString('vi-VN')} VNĐ</li>
                            </ul>
                        </div>
                        <div>
                            <p><strong>Nước:</strong></p>
                            <ul style={styles.list}>
                                <li>Chỉ số cũ: {calculatedBill.previousWaterMeter}</li>
                                <li>Chỉ số mới: {calculatedBill.currentWaterMeter}</li>
                                <li>Sử dụng: {calculatedBill.waterUsage} m³</li>
                                <li>Thành tiền: {calculatedBill.waterCost.toLocaleString('vi-VN')} VNĐ</li>
                            </ul>
                        </div>
                        <p><strong>Internet:</strong> {calculatedBill.internetFee.toLocaleString('vi-VN')} VNĐ</p>
                        <p><strong>Rác:</strong> {calculatedBill.trashFee.toLocaleString('vi-VN')} VNĐ</p>
                        {calculatedBill.otherFeesAmount > 0 && (
                            <p><strong>Phí khác ({calculatedBill.otherFeesDescription}):</strong> {calculatedBill.otherFeesAmount.toLocaleString('vi-VN')} VNĐ</p>
                        )}
                        <p><strong>Các khoản tháng này:</strong> {calculatedBill.currentMonthCharges.toLocaleString('vi-VN')} VNĐ</p>
                        <p style={{color: 'red', fontWeight: 'bold'}}><strong>Nợ cũ còn lại:</strong> {calculatedBill.outstandingPreviousDebt.toLocaleString('vi-VN')} VNĐ</p>
                    </div>
                    <div style={styles.billTotal}>
                        <p style={{fontSize: '1.5em', fontWeight: 'bold', color: 'darkblue'}}>Tổng cộng phải trả: {calculatedBill.totalAmount.toLocaleString('vi-VN')} VNĐ</p>
                    </div>
                    <div style={styles.formActionsRight}>
                        <button
                            onClick={handleSaveBill}
                            style={{...styles.button, ...styles.buttonPrimary}}
                            disabled={isSavingBill}
                        >
                            {isSavingBill ? 'Đang lưu...' : 'Lưu Hóa đơn'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Component Lịch sử Hóa đơn
const BillHistory = ({ bills, rooms, onOpenPaymentModal, onOpenBillDetailModal, setModalState }) => {
    const [filterRoomId, setFilterRoomId] = useState('');
    const [filterMonth, setFilterMonth] = useState('');
    const [filterYear, setFilterYear] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    const filteredBills = useMemo(() => {
        return bills.filter(bill => {
            const matchesRoom = filterRoomId ? bill.roomId === filterRoomId : true;
            const matchesMonth = filterMonth ? bill.billingMonth === parseInt(filterMonth) : true;
            const matchesYear = filterYear ? bill.billingYear === parseInt(filterYear) : true;
            const matchesStatus = filterStatus ? bill.paymentStatus === filterStatus : true;
            return matchesRoom && matchesMonth && matchesYear && matchesStatus;
        });
    }, [bills, filterRoomId, filterMonth, filterYear, filterStatus]);

    const getRoomNumber = useCallback((roomId) => {
        const room = rooms.find(r => r.id === roomId);
        return room ? room.roomNumber : 'N/A';
    }, [rooms]);

    const getPaymentStatusText = (status) => {
        switch (status) {
            case 'Paid': return 'Đã thanh toán';
            case 'Unpaid': return 'Chưa thanh toán';
            case 'Partially Paid': return 'Thanh toán một phần';
            default: return status;
        }
    };

    const getPaymentStatusColor = (status) => {
        switch (status) {
            case 'Paid': return 'green';
            case 'Unpaid': return 'red';
            case 'Partially Paid': return 'orange';
            default: return 'black';
        }
    };

    return (
        <div style={styles.card}>
            <h2 style={styles.cardTitle}>Lịch sử Hóa đơn</h2>

            <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                    <label htmlFor="filterRoom" style={styles.formLabel}>Lọc theo Phòng</label>
                    <select
                        id="filterRoom"
                        value={filterRoomId}
                        onChange={(e) => setFilterRoomId(e.target.value)}
                        style={styles.formInput}
                    >
                        <option value="">Tất cả phòng</option>
                        {rooms.map(room => (
                            <option key={room.id} value={room.id}>Phòng {room.roomNumber}</option>
                        ))}
                    </select>
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="filterMonth" style={styles.formLabel}>Lọc theo Tháng</label>
                    <input
                        type="number"
                        id="filterMonth"
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        min="1"
                        max="12"
                        placeholder="Tháng"
                        style={styles.formInput}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="filterYear" style={styles.formLabel}>Lọc theo Năm</label>
                    <input
                        type="number"
                        id="filterYear"
                        value={filterYear}
                        onChange={(e) => setFilterYear(parseInt(e.target.value))}
                        min="2000"
                        placeholder="Năm"
                        style={styles.formInput}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="filterStatus" style={styles.formLabel}>Lọc theo Trạng thái</label>
                    <select
                        id="filterStatus"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        style={styles.formInput}
                    >
                        <option value="">Tất cả</option>
                        <option value="Unpaid">Chưa thanh toán</option>
                        <option value="Partially Paid">Thanh toán một phần</option>
                        <option value="Paid">Đã thanh toán</option>
                    </select>
                </div>
            </div>

            {filteredBills.length === 0 ? (
                <p style={styles.noDataText}>Không có hóa đơn nào phù hợp với bộ lọc.</p>
            ) : (
                <div style={styles.tableContainer}>
                    <table style={styles.table}>
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeader}>Mã số HĐ</th>
                                <th style={styles.tableHeader}>Phòng</th>
                                <th style={styles.tableHeader}>Người thuê</th>
                                <th style={styles.tableHeader}>Kỳ</th>
                                <th style={styles.tableHeader}>Tổng tiền HĐ</th>
                                <th style={styles.tableHeader}>Nợ cũ HĐ</th>
                                <th style={styles.tableHeader}>Đã TT HĐ</th>
                                <th style={styles.tableHeader}>Còn lại HĐ</th>
                                <th style={styles.tableHeader}>Trạng thái</th>
                                <th style={styles.tableHeader}>Ngày tạo</th>
                                <th style={styles.tableHeader}>Ngày TT</th>
                                <th style={styles.tableHeader}>Hành động</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredBills.map(bill => (
                                <tr key={bill.id} style={styles.tableRow}
                                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = styles.tableRowHover.backgroundColor}
                                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <td style={styles.tableCell}>
                                        <button
                                            onClick={() => onOpenBillDetailModal(bill)}
                                            style={styles.linkButton}
                                        >
                                            {bill.invoiceCode}
                                        </button>
                                    </td>
                                    <td style={styles.tableCell}>{getRoomNumber(bill.roomId)}</td>
                                    <td style={styles.tableCell}>{bill.tenantName}</td>
                                    <td style={styles.tableCell}>Tháng {bill.billingMonth}/{bill.billingYear}</td>
                                    <td style={styles.tableCell}>{bill.totalAmount.toLocaleString('vi-VN')} VNĐ</td>
                                    <td style={{...styles.tableCell, color: 'red', fontWeight: 'bold'}}>{(bill.outstandingPreviousDebt || 0).toLocaleString('vi-VN')} VNĐ</td>
                                    <td style={styles.tableCell}>{(bill.paidAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
                                    <td style={{...styles.tableCell, color: 'red', fontWeight: 'bold'}}>{(bill.remainingAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
                                    <td style={styles.tableCell}>
                                        <span style={{
                                            padding: '4px 8px',
                                            borderRadius: '12px',
                                            fontSize: '0.8em',
                                            fontWeight: 'bold',
                                            backgroundColor: getPaymentStatusColor(bill.paymentStatus) === 'green' ? '#d4edda' :
                                                             getPaymentStatusColor(bill.paymentStatus) === 'red' ? '#f8d7da' :
                                                             getPaymentStatusColor(bill.paymentStatus) === 'orange' ? '#fff3cd' : '#e2e3e5',
                                            color: getPaymentStatusColor(bill.paymentStatus)
                                        }}>
                                            {getPaymentStatusText(bill.paymentStatus)}
                                        </span>
                                    </td>
                                    <td style={styles.tableCell}>{formatDisplayDate(bill.billDate)}</td>
                                    <td style={styles.tableCell}>{bill.paymentDate ? formatDisplayDate(bill.paymentDate) : 'N/A'}</td>
                                    <td style={styles.tableCell}>
                                        {bill.paymentStatus !== 'Paid' && (
                                            <button
                                                onClick={() => onOpenPaymentModal(bill)}
                                                style={{...styles.button, backgroundColor: 'green', fontSize: '0.8em', padding: '5px 10px'}}
                                            >
                                                Thanh toán
                                            </button>
                                        )}
                                        {bill.paymentStatus === 'Paid' && (
                                            <button
                                                style={{...styles.button, backgroundColor: '#ccc', color: '#666', cursor: 'not-allowed', fontSize: '0.8em', padding: '5px 10px'}}
                                                disabled
                                            >
                                                Đã TT
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// Component Quản lý Chi phí
const ExpenseManagement = ({ expenses, onAddExpense, onDeleteExpense, setModalState }) => {
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [isAdding, setIsAdding] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!description || !amount) {
            setModalState({
                title: "Lỗi",
                message: "Vui lòng nhập mô tả và số tiền chi phí.",
                showCancel: false,
                action: () => setModalState({ showModal: false }),
                showModal: true
            });
            return;
        }
        setIsAdding(true);
        await onAddExpense({
            description,
            amount: parseFloat(amount),
            date
        });
        setDescription('');
        setAmount('');
        setDate(new Date().toISOString().split('T')[0]);
        setIsAdding(false);
    };

    return (
        <div style={styles.card}>
            <h2 style={styles.cardTitle}>Quản lý Chi phí</h2>

            <form onSubmit={handleSubmit} style={styles.formGrid}>
                <div style={styles.formGroup}>
                    <label htmlFor="expenseDescription" style={styles.formLabel}>Mô tả chi phí</label>
                    <input
                        type="text"
                        id="expenseDescription"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        required
                        style={isAdding ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isAdding}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="expenseAmount" style={styles.formLabel}>Số tiền (VNĐ)</label>
                    <input
                        type="number"
                        id="expenseAmount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                        min="0"
                        step="1000"
                        style={isAdding ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isAdding}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="expenseDate" style={styles.formLabel}>Ngày</label>
                    <input
                        type="date"
                        id="expenseDate"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        style={isAdding ? {...styles.formInput, ...styles.formInputDisabled} : styles.formInput}
                        disabled={isAdding}
                    />
                </div>
                <div style={{...styles.formActions, gridColumn: '1 / -1'}}>
                    <button
                        type="submit"
                        style={isAdding ? {...styles.button, ...styles.buttonPrimary, ...styles.buttonDisabled} : {...styles.button, ...styles.buttonPrimary}}
                        disabled={isAdding}
                    >
                        {isAdding ? 'Đang thêm...' : 'Thêm Chi phí'}
                    </button>
                </div>
            </form>

            <h3 style={styles.sectionTitle}>Danh sách Chi phí</h3>
            {expenses.length === 0 ? (
                <p style={styles.noDataText}>Chưa có chi phí nào được ghi nhận.</p>
            ) : (
                <div style={styles.tableContainer}>
                    <table style={styles.table}>
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeader}>Mô tả</th>
                                <th style={styles.tableHeader}>Số tiền</th>
                                <th style={styles.tableHeader}>Ngày</th>
                                <th style={styles.tableHeader}>Hành động</th>
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.map(expense => (
                                <tr key={expense.id} style={styles.tableRow}
                                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = styles.tableRowHover.backgroundColor}
                                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <td style={styles.tableCell}>{expense.description}</td>
                                    <td style={styles.tableCell}>{expense.amount.toLocaleString('vi-VN')} VNĐ</td>
                                    <td style={styles.tableCell}>{formatDisplayDate(expense.date)}</td>
                                    <td style={styles.tableCell}>
                                        <button
                                            onClick={() => onDeleteExpense(expense.id)}
                                            style={{...styles.button, backgroundColor: 'red', fontSize: '0.8em', padding: '5px 10px'}}
                                        >
                                            Xóa
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// Component Tổng quan Tài chính
const FinancialOverview = ({ bills, expenses }) => {
    const [filterMonth, setFilterMonth] = useState('');
    const [filterYear, setFilterYear] = useState('');

    const filteredBills = useMemo(() => {
        return bills.filter(bill => {
            const matchesMonth = filterMonth ? bill.billingMonth === parseInt(filterMonth) : true;
            const matchesYear = filterYear ? bill.billingYear === parseInt(filterYear) : true;
            return matchesMonth && matchesYear;
        });
    }, [bills, filterMonth, filterYear]);

    const filteredExpenses = useMemo(() => {
        return expenses.filter(expense => {
            const expenseDate = new Date(expense.date);
            const matchesMonth = filterMonth ? (expenseDate.getMonth() + 1) === parseInt(filterMonth) : true;
            const matchesYear = filterYear ? expenseDate.getFullYear() === parseInt(filterYear) : true;
            return matchesMonth && matchesYear;
        });
    }, [expenses, filterMonth, filterYear]);

    const totalIncome = useMemo(() => filteredBills.reduce((sum, bill) => sum + (bill.paidAmount || 0), 0), [filteredBills]);
    const totalExpenses = useMemo(() => filteredExpenses.reduce((sum, expense) => sum + (expense.amount || 0), 0), [filteredExpenses]);
    const netBalance = totalIncome - totalExpenses;

    return (
        <div style={styles.card}>
            <h2 style={styles.cardTitle}>Tổng quan Tài chính</h2>

            <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                    <label htmlFor="filterMonthOverview" style={styles.formLabel}>Lọc theo Tháng</label>
                    <input
                        type="number"
                        id="filterMonthOverview"
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        min="1"
                        max="12"
                        placeholder="Tháng"
                        style={styles.formInput}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label htmlFor="filterYearOverview" style={styles.formLabel}>Lọc theo Năm</label>
                    <input
                        type="number"
                        id="filterYearOverview"
                        value={filterYear}
                        onChange={(e) => setFilterYear(parseInt(e.target.value))}
                        min="2000"
                        placeholder="Năm"
                        style={styles.formInput}
                    />
                </div>
            </div>

            <div style={styles.summaryBox}>
                <div style={styles.summaryItem}>
                    <p style={styles.summaryLabel}>Tổng thu:</p>
                    <p style={styles.incomeText}>{totalIncome.toLocaleString('vi-VN')} VNĐ</p>
                </div>
                <div style={styles.summaryItem}>
                    <p style={styles.summaryLabel}>Tổng chi phí:</p>
                    <p style={styles.expenseText}>{totalExpenses.toLocaleString('vi-VN')} VNĐ</p>
                </div>
                <div style={{...styles.summaryItem, backgroundColor: netBalance >= 0 ? '#e0f7fa' : '#ffe0b2'}}>
                    <p style={styles.summaryLabel}>Số dư ròng:</p>
                    <p style={{fontWeight: 'bold', fontSize: '1.2em', color: netBalance >= 0 ? 'darkblue' : 'orange'}}>
                        {netBalance.toLocaleString('vi-VN')} VNĐ
                    </p>
                </div>
            </div>

            <div style={{marginTop: '20px'}}>
                <h3 style={styles.sectionTitle}>Phân tích nợ phòng</h3>
                {bills.filter(bill => bill.remainingAmount > 0).length === 0 ? (
                    <p style={styles.noDataText}>Không có hóa đơn nào đang nợ.</p>
                ) : (
                    <div style={styles.tableContainer}>
                        <table style={styles.table}>
                            <thead>
                                <tr style={styles.tableHeaderRow}>
                                    <th style={styles.tableHeader}>Phòng</th>
                                    <th style={styles.tableHeader}>Kỳ</th>
                                    <th style={styles.tableHeader}>Tổng tiền HĐ</th>
                                    <th style={styles.tableHeader}>Đã TT HĐ</th>
                                    <th style={styles.tableHeader}>Còn lại HĐ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bills.filter(bill => bill.remainingAmount > 0).map(bill => (
                                    <tr key={bill.id} style={styles.tableRow}
                                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = styles.tableRowHover.backgroundColor}
                                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <td style={styles.tableCell}>{bill.roomNumber}</td>
                                        <td style={styles.tableCell}>Tháng {bill.billingMonth}/{bill.billingYear}</td>
                                        <td style={styles.tableCell}>{bill.totalAmount.toLocaleString('vi-VN')} VNĐ</td>
                                        <td style={styles.tableCell}>{(bill.paidAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
                                        <td style={{...styles.tableCell, color: 'red', fontWeight: 'bold'}}>{(bill.remainingAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};


// Export App component wrapped with FirebaseProvider
export default function WrappedApp() {
    return (
        <FirebaseProvider>
            <App />
        </FirebaseProvider>
    );
}

// Basic CSS Styles
const styles = {
    // Global
    appContainer: {
        minHeight: '100vh',
        backgroundColor: '#f0f2f5',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Arial, sans-serif',
    },
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '10px',
        width: '100%',
        boxSizing: 'border-box',
    },
    mainContent: {
        flexGrow: 1,
        padding: '10px',
    },
    card: {
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '20px',
        width: '100%',
        boxSizing: 'border-box',
    },
    cardTitle: {
        fontSize: '1.5em',
        fontWeight: 'bold',
        color: '#333',
        marginBottom: '15px',
    },
    sectionTitle: {
        fontSize: '1.2em',
        fontWeight: 'bold',
        color: '#333',
        marginBottom: '10px',
    },
    noDataText: {
        color: '#666',
        fontSize: '0.9em',
    },

    // Header
    header: {
        backgroundColor: '#1976D2', // Deep Blue
        color: '#fff',
        padding: '15px 10px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    headerTitle: {
        fontSize: '1.5em',
        fontWeight: 'bold',
        margin: '0',
    },
    userIdText: {
        fontSize: '0.8em',
        color: '#BBDEFB', // Light Blue
        wordBreak: 'break-all',
    },
    logoutButton: {
        backgroundColor: '#1565C0', // Darker Blue
        color: '#fff',
        border: 'none',
        padding: '8px 12px',
        borderRadius: '5px',
        cursor: 'pointer',
        fontSize: '0.8em',
        transition: 'background-color 0.2s',
        marginLeft: '10px',
    },
    logoutButtonHover: {
        backgroundColor: '#0D47A1', // Even Darker Blue
    },

    // Navigation
    nav: {
        backgroundColor: '#2196F3', // Medium Blue
        padding: '10px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
    },
    navContainer: {
        display: 'flex',
        gap: '8px',
        paddingBottom: '5px', // For scrollbar
    },
    navButton: {
        backgroundColor: 'transparent',
        color: '#E3F2FD', // Very Light Blue
        border: 'none',
        padding: '8px 12px',
        borderRadius: '5px',
        cursor: 'pointer',
        fontSize: '0.9em',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        transition: 'background-color 0.2s',
        flexShrink: 0, // Prevent shrinking
    },
    navButtonActive: {
        backgroundColor: '#1976D2', // Deep Blue
        color: '#fff',
    },
    navButtonHover: {
        backgroundColor: '#1E88E5', // Slightly darker blue
    },

    // Forms
    formGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '15px',
        marginBottom: '15px',
    },
    formGroup: {
        marginBottom: '10px',
    },
    formLabel: {
        display: 'block',
        fontSize: '0.9em',
        color: '#555',
        marginBottom: '5px',
    },
    formInput: {
        width: '100%',
        padding: '8px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        fontSize: '1em',
        boxSizing: 'border-box',
    },
    formInputDisabled: {
        backgroundColor: '#eee',
        cursor: 'not-allowed',
    },
    formActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
        marginTop: '20px',
        gridColumn: '1 / -1', // Span all columns in grid
    },
    formActionsRight: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
        marginTop: '20px',
    },

    // Buttons
    button: {
        padding: '10px 15px',
        borderRadius: '5px',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1em',
        fontWeight: 'bold',
        transition: 'background-color 0.2s, opacity 0.2s',
    },
    buttonPrimary: {
        backgroundColor: '#2196F3', // Blue
        color: '#fff',
    },
    buttonSecondary: {
        backgroundColor: '#9E9E9E', // Gray
        color: '#fff',
    },
    buttonSuccess: {
        backgroundColor: '#4CAF50', // Green
        color: '#fff',
    },
    buttonWarning: {
        backgroundColor: '#FFC107', // Yellow
        color: '#333',
    },
    buttonDanger: {
        backgroundColor: '#F44336', // Red
        color: '#fff',
    },
    buttonDisabled: {
        opacity: 0.6,
        cursor: 'not-allowed',
    },
    linkButton: {
        background: 'none',
        border: 'none',
        color: '#2196F3',
        textDecoration: 'underline',
        cursor: 'pointer',
        padding: '0',
        fontSize: '1em',
    },

    // Room List Specific
    roomGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '15px',
    },
    roomCard: {
        backgroundColor: '#E3F2FD', // Light Blue
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        border: '1px solid #BBDEFB', // Lighter Blue
    },
    roomCardTitle: {
        fontSize: '1.2em',
        fontWeight: 'bold',
        color: '#1976D2', // Deep Blue
        marginBottom: '5px',
    },
    roomStatusOccupied: { color: 'red', fontWeight: 'bold' },
    roomStatusVacant: { color: 'green', fontWeight: 'bold' },
    roomStatusMaintenance: { color: 'orange', fontWeight: 'bold' },
    roomDebt: { color: 'red', fontWeight: 'bold' },

    // Info Boxes (for Bill Generator)
    infoBox: {
        backgroundColor: '#E3F2FD',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        marginBottom: '15px',
    },
    infoBoxTitle: {
        fontSize: '1.1em',
        fontWeight: 'bold',
        color: '#1976D2',
        marginBottom: '10px',
    },
    infoBoxContent: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px',
    },
    historyBox: {
        marginTop: '15px',
        paddingTop: '15px',
        borderTop: '1px solid #BBDEFB',
    },
    historyBoxTitle: {
        fontSize: '1em',
        fontWeight: 'bold',
        color: '#333',
        marginBottom: '8px',
    },
    historyEntry: {
        marginBottom: '5px',
        padding: '8px',
        backgroundColor: '#F0F2F5',
        borderRadius: '4px',
        fontSize: '0.9em',
    },

    // Bill Preview
    billPreview: {
        border: '1px solid #BBDEFB',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: '#E3F2FD',
    },
    billPreviewTitle: {
        fontSize: '1.5em',
        fontWeight: 'bold',
        color: '#333',
        marginBottom: '15px',
    },
    billTotal: {
        marginTop: '20px',
        paddingTop: '15px',
        borderTop: '1px solid #BBDEFB',
        textAlign: 'right',
    },

    // Tables
    tableContainer: {
        overflowX: 'auto',
        marginBottom: '20px',
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        backgroundColor: '#fff',
        borderRadius: '8px',
        overflow: 'hidden', // Ensures rounded corners apply to table
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    },
    tableHeaderRow: {
        backgroundColor: '#E0E0E0', // Light Gray
        textAlign: 'left',
        fontSize: '0.9em',
        fontWeight: 'bold',
        color: '#555',
        borderBottom: '1px solid #ccc',
    },
    tableHeader: {
        padding: '10px 12px',
        whiteSpace: 'nowrap',
    },
    tableRow: {
        borderBottom: '1px solid #eee',
        transition: 'background-color 0.2s',
    },
    tableRowHover: {
        backgroundColor: '#f5f5f5',
    },
    tableCell: {
        padding: '8px 12px',
        fontSize: '0.9em',
        color: '#333',
        whiteSpace: 'nowrap',
    },

    // Modals
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        padding: '25px',
        maxWidth: '400px',
        width: '100%',
        boxSizing: 'border-box',
    },
    modalContentLarge: {
        backgroundColor: '#fff',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        padding: '25px',
        maxWidth: '800px',
        width: '100%',
        boxSizing: 'border-box',
        maxHeight: '90vh',
        overflowY: 'auto',
    },
    modalHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '15px',
    },
    modalTitle: {
        fontSize: '1.5em',
        fontWeight: 'bold',
        color: '#333',
        margin: '0',
    },
    modalCloseButton: {
        background: 'none',
        border: 'none',
        fontSize: '2em',
        color: '#666',
        cursor: 'pointer',
        lineHeight: '1',
    },
    modalMessage: {
        color: '#555',
        marginBottom: '20px',
    },
    modalText: {
        marginBottom: '10px',
    },
    modalTextBold: {
        fontWeight: 'bold',
    },
    modalActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
        marginTop: '20px',
    },
    list: {
        listStyle: 'disc',
        marginLeft: '20px',
        marginBottom: '10px',
    },
    loadingContainer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f2f5',
    },
    loadingText: {
        fontSize: '1.2em',
        fontWeight: 'bold',
        color: '#555',
    },
    loginTitle: {
        fontSize: '1.5em',
        fontWeight: 'bold',
        textAlign: 'center',
        color: '#333',
        marginBottom: '20px',
    },
    loginForm: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
    },
    footer: {
        backgroundColor: '#333',
        color: '#fff',
        padding: '15px',
        textAlign: 'center',
        fontSize: '0.8em',
        boxShadow: '0 -2px 4px rgba(0,0,0,0.1)',
    }
};
