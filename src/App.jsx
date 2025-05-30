import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
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

    useEffect(() => {
        const initializeFirebase = async () => {
            try {
                const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
                const app = initializeApp(firebaseConfig);
                const firestore = getFirestore(app);
                const authInstance = getAuth(app);

                setDb(firestore);
                setAuth(authInstance);

                // Đăng nhập người dùng
                if (typeof __initial_auth_token !== 'undefined') {
                    await signInWithCustomToken(authInstance, __initial_auth_token);
                } else {
                    await signInAnonymously(authInstance);
                }

                // Lắng nghe thay đổi trạng thái xác thực
                onAuthStateChanged(authInstance, (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        // Nếu người dùng đăng xuất, thiết lập lại userId
                        setUserId(null);
                    }
                    setLoadingFirebase(false);
                });

            } catch (error) {
                console.error("Lỗi khi khởi tạo Firebase:", error);
                setLoadingFirebase(false);
            }
        };

        initializeFirebase();
    }, []);

    if (loadingFirebase) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-lg font-semibold text-gray-700">Đang tải ứng dụng...</div>
            </div>
        );
    }

    return (
        <FirebaseContext.Provider value={{ db, auth, userId }}>
            {children}
        </FirebaseContext.Provider>
    );
};

// Component Modal tùy chỉnh thay thế alert/confirm
const CustomModal = ({ title, message, onConfirm, onCancel, showCancel = true }) => {
    if (!message) return null; // Không hiển thị modal nếu không có tin nhắn

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-auto">
                <h3 className="text-xl font-bold text-gray-800 mb-4">{title}</h3>
                <div className="text-gray-700 mb-6">{message}</div>
                <div className="flex justify-end space-x-3">
                    {showCancel && (
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition duration-200"
                        >
                            Hủy
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200"
                    >
                        Xác nhận
                    </button>
                </div>
            </div>
        </div>
    );
};

// Component để xử lý thanh toán hóa đơn
const PaymentModal = ({ bill, onClose, onProcessPayment, setModalMessage, setModalTitle, setShowCancelModal, setModalAction }) => {
    const [paymentAmount, setPaymentAmount] = useState(bill.remainingAmount || bill.totalAmount);

    const handlePayment = () => {
        if (paymentAmount <= 0) {
            setModalTitle("Lỗi");
            setModalMessage("Số tiền thanh toán phải lớn hơn 0.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }
        // Cho phép thanh toán dư để cấn trừ nợ tổng
        onProcessPayment(bill.id, bill.roomId, paymentAmount);
        onClose();
    };

    return (
        <CustomModal
            title={`Thanh toán Hóa đơn Phòng ${bill.roomNumber}`}
            message={
                <div>
                    <p className="mb-2">Tổng tiền hóa đơn: <span className="font-bold">{bill.totalAmount.toLocaleString('vi-VN')} VNĐ</span></p>
                    <p className="mb-4">Số tiền còn lại: <span className="font-bold text-red-600">{bill.remainingAmount.toLocaleString('vi-VN')} VNĐ</span></p>
                    <label htmlFor="paymentAmount" className="block text-sm font-medium text-gray-700">Số tiền thanh toán (VNĐ)</label>
                    <input
                        type="number"
                        id="paymentAmount"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        min="0"
                        step="1000"
                    />
                </div>
            }
            onConfirm={handlePayment}
            onCancel={onClose}
            showCancel={true}
        />
    );
};

// Component để hiển thị chi tiết hóa đơn
const BillDetailModal = ({ bill, onClose }) => { // Removed onGenerateTenantMessage prop
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
            case 'Paid': return 'text-green-600';
            case 'Unpaid': return 'text-red-600';
            case 'Partially Paid': return 'text-yellow-600';
            default: return 'text-gray-800';
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-auto overflow-y-auto max-h-[90vh]">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-2xl font-bold text-gray-800">Chi tiết Hóa đơn {bill.invoiceCode}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
                    >
                        &times;
                    </button>
                </div>
                <div className="space-y-3 text-gray-700 mb-6">
                    <p><strong>Phòng:</strong> {bill.roomNumber}</p>
                    <p><strong>Người thuê:</strong> {bill.tenantName}</p>
                    <p><strong>Kỳ:</strong> Tháng {bill.billingMonth}/{bill.billingYear}</p>
                    <p><strong>Tiền phòng tháng này:</strong> {bill.rentAmount.toLocaleString('vi-VN')} VNĐ</p>
                    <p><strong>Điện:</strong></p>
                    <ul className="list-disc list-inside ml-4">
                        <li>Chỉ số cũ: {bill.previousElectricityMeter}</li>
                        <li>Chỉ số mới: {bill.currentElectricityMeter}</li>
                        <li>Sử dụng: {bill.electricityUsage} kWh</li>
                        <li>Thành tiền: {bill.electricityCost.toLocaleString('vi-VN')} VNĐ</li>
                    </ul>
                    <p><strong>Nước:</strong></p>
                    <ul className="list-disc list-inside ml-4">
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
                    <p className="text-red-600 font-semibold"><strong>Nợ cũ còn lại:</strong> {bill.outstandingPreviousDebt.toLocaleString('vi-VN')} VNĐ</p>
                    <p className="text-blue-800 font-bold text-xl">Tổng cộng phải trả: {bill.totalAmount.toLocaleString('vi-VN')} VNĐ</p>
                    <p><strong>Đã thanh toán:</strong> {(bill.paidAmount || 0).toLocaleString('vi-VN')} VNĐ</p>
                    <p><strong>Còn lại:</strong> <span className={`font-bold ${getPaymentStatusColor(bill.paymentStatus)}`}>{(bill.remainingAmount || 0).toLocaleString('vi-VN')} VNĐ</span></p>
                    <p><strong>Trạng thái thanh toán:</strong> <span className={`font-semibold ${getPaymentStatusColor(bill.paymentStatus)}`}>{getPaymentStatusText(bill.paymentStatus)}</span></p>
                    <p><strong>Ngày tạo hóa đơn:</strong> {formatDisplayDate(bill.billDate)}</p>
                    {bill.paymentDate && <p><strong>Ngày thanh toán:</strong> {formatDisplayDate(bill.paymentDate)}</p>}
                </div>
                <div className="flex justify-end space-x-3">
                    {/* Removed Gemini message button */}
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition duration-200"
                    >
                        Đóng
                    </button>
                </div>
            </div>
        </div>
    );
};

// Removed GeminiMessageModal component

// Component chính của ứng dụng
function App() {
    const { db, userId, loadingFirebase } = useContext(FirebaseContext);
    const [rooms, setRooms] = useState([]);
    const [serviceSettings, setServiceSettings] = useState(null);
    const [bills, setBills] = useState([]); // State để lưu trữ hóa đơn
    const [expenses, setExpenses] = useState([]); // State để lưu trữ chi phí
    const [currentPage, setCurrentPage] = useState('roomList'); // 'roomList', 'addRoom', 'editRoom', 'serviceSettings', 'billGenerator', 'billHistory', 'expenseManagement', 'financialOverview'
    const [selectedRoom, setSelectedRoom] = useState(null);
    const [modalMessage, setModalMessage] = useState('');
    const [modalTitle, setModalTitle] = useState('');
    const [modalAction, setModalAction] = useState(null);
    const [showCancelModal, setShowCancelModal] = useState(true);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [billToPay, setBillToPay] = useState(null);
    const [showBillDetailModal, setShowBillDetailModal] = useState(false);
    const [billToView, setBillToView] = useState(null);
    // Removed Gemini related states: showGeminiMessageModal, geminiMessageContent


    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // Lắng nghe dữ liệu phòng từ Firestore
    useEffect(() => {
        if (!db || !userId) return;

        const roomsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/rooms`);
        const q = query(roomsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const roomsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sắp xếp theo số phòng
            roomsData.sort((a, b) => {
                const roomA = parseInt(a.roomNumber.replace(/\D/g, ''), 10);
                const roomB = parseInt(b.roomNumber.replace(/\D/g, ''), 10);
                return roomA - roomB;
            });
            setRooms(roomsData);
        }, (error) => {
            console.error("Lỗi khi tải dữ liệu phòng:", error);
            setModalTitle("Lỗi");
            setModalMessage("Không thể tải dữ liệu phòng. Vui lòng thử lại.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        });

        return () => unsubscribe();
    }, [db, userId, appId]);

    // Lắng nghe cài đặt dịch vụ từ Firestore
    useEffect(() => {
        if (!db || !userId) return;

        const settingsDocRef = doc(db, `artifacts/${appId}/users/${userId}/serviceSettings`, 'settingsDoc');

        const unsubscribe = onSnapshot(settingsDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setServiceSettings(docSnap.data());
            } else {
                // Thiết lập giá trị mặc định nếu chưa có cài đặt
                setServiceSettings({
                    electricityPrice: 3000, // VNĐ/kWh
                    waterPrice: 15000,    // VNĐ/m3
                    internetPrice: 100000, // VNĐ/tháng
                    trashPrice: 20000      // VNĐ/tháng
                });
            }
        }, (error) => {
            console.error("Lỗi khi tải cài đặt dịch vụ:", error);
            setModalTitle("Lỗi");
            setModalMessage("Không thể tải cài đặt dịch vụ. Vui lòng thử lại.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        });

        return () => unsubscribe();
    }, [db, userId, appId]);

    // Lắng nghe dữ liệu hóa đơn từ Firestore
    useEffect(() => {
        if (!db || !userId) return;

        const billsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/bills`);
        const q = query(billsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const billsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sắp xếp hóa đơn theo ngày tạo mới nhất (mới lên trên, cũ xuống dưới)
            billsData.sort((a, b) => new Date(b.billDate) - new Date(a.billDate));
            setBills(billsData);
        }, (error) => {
            console.error("Lỗi khi tải dữ liệu hóa đơn:", error);
            setModalTitle("Lỗi");
            setModalMessage("Không thể tải dữ liệu hóa đơn. Vui lòng thử lại.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        });

        return () => unsubscribe();
    }, [db, userId, appId]);

    // Lắng nghe dữ liệu chi phí từ Firestore
    useEffect(() => {
        if (!db || !userId) return;

        const expensesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/expenses`);
        const q = query(expensesCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const expensesData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            expensesData.sort((a, b) => new Date(b.date) - new Date(a.date)); // Sắp xếp theo ngày mới nhất
            setExpenses(expensesData);
        }, (error) => {
            console.error("Lỗi khi tải dữ liệu chi phí:", error);
            setModalTitle("Lỗi");
            setModalMessage("Không thể tải dữ liệu chi phí. Vui lòng thử lại.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        });

        return () => unsubscribe();
    }, [db, userId, appId]);

    // Hàm thêm/cập nhật phòng
    const handleSaveRoom = async (roomData) => {
        if (!db || !userId) {
            setModalTitle("Lỗi");
            setModalMessage("Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }

        try {
            const roomsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/rooms`);

            if (roomData.id) {
                // Cập nhật phòng hiện có
                const roomRef = doc(roomsCollectionRef, roomData.id);
                // Destructure để loại bỏ 'id' khỏi dữ liệu đang được cập nhật
                const { id, ...dataToUpdate } = roomData;
                await updateDoc(roomRef, dataToUpdate);
                setModalTitle("Thành công");
                setModalMessage("Thông tin phòng đã được cập nhật!");
            } else {
                // Thêm phòng mới
                // Destructure để đảm bảo 'id' không được truyền vào addDoc, vì Firestore sẽ tự tạo
                const { id, ...dataToAdd } = roomData;
                await addDoc(roomsCollectionRef, dataToAdd);
                setModalTitle("Thành công");
                setModalMessage("Phòng mới đã được thêm!");
            }
            setShowCancelModal(false);
            setModalAction(() => () => {
                setModalMessage('');
                setCurrentPage('roomList');
                setSelectedRoom(null);
            });
        } catch (error) {
            console.error("Lỗi khi lưu phòng:", error);
            setModalTitle("Lỗi");
            setModalMessage(`Không thể lưu phòng: ${error.message}`);
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        }
    };

    // Hàm xóa phòng
    const handleDeleteRoom = (room) => {
        setModalTitle("Xác nhận xóa");
        setModalMessage(`Bạn có chắc chắn muốn xóa phòng "${room.roomNumber}" không?`);
        setShowCancelModal(true);
        setModalAction(() => async () => {
            if (!db || !userId) {
                setModalTitle("Lỗi");
                setModalMessage("Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
                setShowCancelModal(false);
                setModalAction(() => () => setModalMessage(''));
                return;
            }
            try {
                const roomsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/rooms`);
                const roomRef = doc(roomsCollectionRef, room.id);
                await deleteDoc(roomRef);
                setModalTitle("Thành công");
                setModalMessage("Phòng đã được xóa.");
                setShowCancelModal(false);
                setModalAction(() => () => setModalMessage(''));
            } catch (error) {
                console.error("Lỗi khi xóa phòng:", error);
                setModalTitle("Lỗi");
                setModalMessage(`Không thể xóa phòng: ${error.message}`);
                setShowCancelModal(false);
                setModalAction(() => () => setModalMessage(''));
            }
        });
    };

    // Hàm lưu cài đặt dịch vụ
    const handleSaveServiceSettings = async (settingsData) => {
        if (!db || !userId) {
            setModalTitle("Lỗi");
            setModalMessage("Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }
        try {
            const settingsDocRef = doc(db, `artifacts/${appId}/users/${userId}/serviceSettings`, 'settingsDoc');
            await setDoc(settingsDocRef, settingsData, { merge: true }); // Dùng setDoc với merge để cập nhật hoặc tạo mới
            setModalTitle("Thành công");
            setModalMessage("Cài đặt dịch vụ đã được cập nhật!");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        } catch (error) {
            console.error("Lỗi khi lưu cài đặt dịch vụ:", error);
            setModalTitle("Lỗi");
            setModalMessage(`Không thể lưu cài đặt dịch vụ: ${error.message}`);
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        }
    };

    // Hàm xử lý thanh toán hóa đơn (từ PaymentModal)
    const handleProcessPayment = async (billId, roomId, paymentAmount) => {
        if (!db || !userId) {
            setModalTitle("Lỗi");
            setModalMessage("Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }

        try {
            const billRef = doc(collection(db, `artifacts/${appId}/users/${userId}/bills`), billId);
            const roomRef = doc(collection(db, `artifacts/${appId}/users/${userId}/rooms`), roomId);

            // Lấy dữ liệu hóa đơn và phòng hiện tại
            const billSnap = await getDoc(billRef);
            const roomSnap = await getDoc(roomRef);

            if (!billSnap.exists() || !roomSnap.exists()) {
                setModalTitle("Lỗi");
                setModalMessage("Không tìm thấy hóa đơn hoặc phòng để cập nhật.");
                setShowCancelModal(false);
                setModalAction(() => () => setModalMessage(''));
                return;
            }

            const currentBillData = billSnap.data();
            const currentRoomData = roomSnap.data();

            let newPaidAmountForBill = (currentBillData.paidAmount || 0) + paymentAmount;
            let newRemainingAmountForBill = currentBillData.totalAmount - newPaidAmountForBill;
            let newPaymentStatus = 'Partially Paid';

            if (newRemainingAmountForBill <= 0) {
                newPaymentStatus = 'Paid';
                newRemainingAmountForBill = 0; // Đảm bảo không âm
            }

            // Cập nhật hóa đơn
            await updateDoc(billRef, {
                paidAmount: newPaidAmountForBill,
                remainingAmount: newRemainingAmountForBill,
                paymentStatus: newPaymentStatus,
                paymentDate: new Date().toISOString().split('T')[0] // Cập nhật ngày thanh toán
            });

            // Cập nhật tổng nợ của phòng: trừ đi số tiền vừa thanh toán
            const currentRoomDebt = currentRoomData.debtAmount || 0;
            const updatedRoomDebt = Math.max(0, currentRoomDebt - paymentAmount); // Cho phép thanh toán dư để cấn trừ nợ

            await updateDoc(roomRef, {
                debtAmount: updatedRoomDebt,
                lastPaymentDate: new Date().toISOString().split('T')[0]
            });

            setModalTitle("Thành công");
            setModalMessage("Thanh toán đã được xử lý và thông tin đã được cập nhật.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        } catch (error) {
            console.error("Lỗi khi xử lý thanh toán:", error);
            setModalTitle("Lỗi");
            setModalMessage(`Không thể xử lý thanh toán: ${error.message}`);
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        }
    };

    // Hàm thêm chi phí
    const handleAddExpense = async (expenseData) => {
        if (!db || !userId) {
            setModalTitle("Lỗi");
            setModalMessage("Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }
        try {
            const expensesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/expenses`);
            await addDoc(expensesCollectionRef, expenseData);
            setModalTitle("Thành công");
            setModalMessage("Chi phí đã được thêm!");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        } catch (error) {
            console.error("Lỗi khi thêm chi phí:", error);
            setModalTitle("Lỗi");
            setModalMessage(`Không thể thêm chi phí: ${error.message}`);
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        }
    };

    // Hàm xóa chi phí
    const handleDeleteExpense = async (expenseId) => {
        if (!db || !userId) {
            setModalTitle("Lỗi");
            setModalMessage("Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }
        setModalTitle("Xác nhận xóa");
        setModalMessage("Bạn có chắc chắn muốn xóa chi phí này không?");
        setShowCancelModal(true);
        setModalAction(() => async () => {
            try {
                const expenseRef = doc(collection(db, `artifacts/${appId}/users/${userId}/expenses`), expenseId);
                await deleteDoc(expenseRef);
                setModalTitle("Thành công");
                setModalMessage("Chi phí đã được xóa.");
                setShowCancelModal(false);
                setModalAction(() => () => setModalMessage(''));
            } catch (error) {
                console.error("Lỗi khi xóa chi phí:", error);
                setModalTitle("Lỗi");
                setModalMessage(`Không thể xóa chi phí: ${error.message}`);
                setShowCancelModal(false);
                setModalAction(() => () => setModalMessage(''));
            }
        });
    };

    // Hàm hiển thị chi tiết phòng hoặc form chỉnh sửa
    const handleViewRoom = (room) => {
        setSelectedRoom(room);
        setCurrentPage('roomDetail');
    };

    const handleEditRoom = (room) => {
        setSelectedRoom(room);
        setCurrentPage('editRoom');
    };

    const handleCancelModal = () => {
        setModalMessage('');
        setModalAction(null);
    };

    const handleOpenPaymentModal = (bill) => {
        setBillToPay(bill);
        setShowPaymentModal(true);
    };

    const handleClosePaymentModal = () => {
        setShowPaymentModal(false);
        setBillToPay(null);
    };

    const handleOpenBillDetailModal = (bill) => {
        setBillToView(bill);
        setShowBillDetailModal(true);
    };

    const handleCloseBillDetailModal = () => {
        setShowBillDetailModal(false);
        setBillToView(null);
    };

    if (loadingFirebase) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-lg font-semibold text-gray-700">Đang tải ứng dụng...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col font-inter">
            {modalMessage && (
                <CustomModal
                    title={modalTitle}
                    message={modalMessage}
                    onConfirm={modalAction}
                    onCancel={handleCancelModal}
                    showCancel={showCancelModal}
                />
            )}
            {showPaymentModal && billToPay && (
                <PaymentModal
                    bill={billToPay}
                    onClose={handleClosePaymentModal}
                    onProcessPayment={handleProcessPayment}
                    setModalMessage={setModalMessage}
                    setModalTitle={setModalTitle}
                    setShowCancelModal={setShowCancelModal}
                    setModalAction={setModalAction}
                />
            )}
            {showBillDetailModal && billToView && (
                <BillDetailModal
                    bill={billToView}
                    onClose={handleCloseBillDetailModal}
                />
            )}

            <header className="bg-blue-600 text-white p-4 shadow-md">
                <div className="container mx-auto flex justify-between items-center">
                    <h1 className="text-xl sm:text-2xl font-bold">QUẢN LÝ PHÒNG TRỌ - ÔNG BẢY TUẤN</h1> {/* Uppercase and bold */}
                    <div className="text-xs sm:text-sm">
                        User ID: <span className="font-mono text-blue-200 break-all">{userId}</span>
                    </div>
                </div>
            </header>

            <nav className="bg-blue-500 p-3 shadow-sm">
                <div className="container mx-auto flex space-x-2 sm:space-x-4 overflow-x-auto pb-1">
                    <button
                        onClick={() => { setCurrentPage('roomList'); setSelectedRoom(null); }}
                        className={`px-3 py-2 sm:px-4 sm:py-2 rounded-md transition duration-200 whitespace-nowrap text-sm sm:text-base font-bold uppercase ${currentPage === 'roomList' ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-600'}`}
                    >
                        Danh sách Phòng
                    </button>
                    <button
                        onClick={() => { setCurrentPage('addRoom'); setSelectedRoom(null); }}
                        className={`px-3 py-2 sm:px-4 sm:py-2 rounded-md transition duration-200 whitespace-nowrap text-sm sm:text-base font-bold uppercase ${currentPage === 'addRoom' ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-600'}`}
                    >
                        Thêm Phòng Mới
                    </button>
                    <button
                        onClick={() => { setCurrentPage('serviceSettings'); setSelectedRoom(null); }}
                        className={`px-3 py-2 sm:px-4 sm:py-2 rounded-md transition duration-200 whitespace-nowrap text-sm sm:text-base font-bold uppercase ${currentPage === 'serviceSettings' ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-600'}`}
                    >
                        Cài đặt Dịch vụ
                    </button>
                    <button
                        onClick={() => { setCurrentPage('billGenerator'); setSelectedRoom(null); }}
                        className={`px-3 py-2 sm:px-4 sm:py-2 rounded-md transition duration-200 whitespace-nowrap text-sm sm:text-base font-bold uppercase ${currentPage === 'billGenerator' ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-600'}`}
                    >
                        Tính Tiền Phòng
                    </button>
                    <button
                        onClick={() => { setCurrentPage('billHistory'); setSelectedRoom(null); }}
                        className={`px-3 py-2 sm:px-4 sm:py-2 rounded-md transition duration-200 whitespace-nowrap text-sm sm:text-base font-bold uppercase ${currentPage === 'billHistory' ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-600'}`}
                    >
                        Lịch sử Hóa đơn
                    </button>
                    <button
                        onClick={() => { setCurrentPage('expenseManagement'); setSelectedRoom(null); }}
                        className={`px-3 py-2 sm:px-4 sm:py-2 rounded-md transition duration-200 whitespace-nowrap text-sm sm:text-base font-bold uppercase ${currentPage === 'expenseManagement' ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-600'}`}
                    >
                        Quản lý Chi phí
                    </button>
                    <button
                        onClick={() => { setCurrentPage('financialOverview'); setSelectedRoom(null); }}
                        className={`px-3 py-2 sm:px-4 sm:py-2 rounded-md transition duration-200 whitespace-nowrap text-sm sm:text-base font-bold uppercase ${currentPage === 'financialOverview' ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-600'}`}
                    >
                        Tổng quan Tài chính
                    </button>
                </div>
            </nav>

            <main className="flex-grow container mx-auto p-2 sm:p-4">
                {currentPage === 'roomList' && (
                    <RoomList
                        rooms={rooms}
                        onViewRoom={handleViewRoom}
                        onEditRoom={handleEditRoom}
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
                        onEdit={handleEditRoom}
                        onDelete={handleDeleteRoom}
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
                        setModalMessage={setModalMessage}
                        setModalTitle={setModalTitle}
                        setShowCancelModal={setShowCancelModal}
                        setModalAction={setModalAction}
                    />
                )}
                {currentPage === 'billHistory' && (
                    <BillHistory
                        bills={bills}
                        rooms={rooms} // Cần rooms để hiển thị tên phòng
                        onOpenPaymentModal={handleOpenPaymentModal} // Truyền hàm mở modal thanh toán
                        onOpenBillDetailModal={handleOpenBillDetailModal} // Truyền hàm mở modal chi tiết hóa đơn
                        setModalMessage={setModalMessage}
                        setModalTitle={setModalTitle}
                        setShowCancelModal={setShowCancelModal}
                        setModalAction={setModalAction}
                    />
                )}
                {currentPage === 'expenseManagement' && (
                    <ExpenseManagement
                        expenses={expenses}
                        onAddExpense={handleAddExpense}
                        onDeleteExpense={handleDeleteExpense}
                        setModalMessage={setModalMessage}
                        setModalTitle={setModalTitle}
                        setShowCancelModal={setShowCancelModal}
                        setModalAction={setModalAction}
                    />
                )}
                {currentPage === 'financialOverview' && (
                    <FinancialOverview
                        bills={bills}
                        expenses={expenses}
                    />
                )}
            </main>

            <footer className="bg-gray-800 text-white p-4 text-center text-sm shadow-inner">
                &copy; 2025 - Ứng dụng Quản lý Phòng Trọ by Trí Thành - version: 1.05.2025
            </footer>
        </div>
    );
}

// Component Danh sách Phòng
const RoomList = ({ rooms, onViewRoom, onEditRoom, onDeleteRoom }) => {
    return (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Danh sách Phòng</h2>
            {rooms.length === 0 ? (
                <p className="text-sm sm:text-base text-gray-600">Chưa có phòng nào được thêm. Hãy thêm một phòng mới!</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {rooms.map(room => (
                        <div key={room.id} className="bg-blue-50 p-3 sm:p-4 rounded-lg shadow-sm border border-blue-200 hover:shadow-md transition duration-200">
                            <h3 className="text-lg sm:text-xl font-bold text-blue-800 mb-1 sm:mb-2">Phòng {room.roomNumber}</h3>
                            <p className="text-sm sm:text-base text-gray-700"><strong>Trạng thái:</strong> <span className={`font-semibold ${room.status === 'Occupied' ? 'text-red-600' : room.status === 'Vacant' ? 'text-green-600' : 'text-yellow-600'}`}>{room.status === 'Occupied' ? 'Đang thuê' : room.status === 'Vacant' ? 'Trống' : 'Bảo trì'}</span></p>
                            {room.tenantName && <p className="text-sm sm:text-base text-gray-700"><strong>Người thuê:</strong> {room.tenantName}</p>}
                            {room.rentAmount && <p className="text-sm sm:text-base text-gray-700"><strong>Giá thuê:</strong> {parseInt(room.rentAmount).toLocaleString('vi-VN')} VNĐ</p>}
                            {room.debtAmount > 0 && <p className="text-sm sm:text-base text-red-600 font-semibold"><strong>Nợ:</strong> {parseInt(room.debtAmount).toLocaleString('vi-VN')} VNĐ</p>}
                            <div className="flex justify-end space-x-2 mt-3 sm:mt-4">
                                <button
                                    onClick={() => onViewRoom(room)}
                                    className="px-2 py-1 sm:px-3 sm:py-1 bg-blue-500 text-white rounded-md text-xs sm:text-sm hover:bg-blue-600 transition duration-200"
                                >
                                    Chi tiết
                                </button>
                                <button
                                    onClick={() => onEditRoom(room)}
                                    className="px-2 py-1 sm:px-3 sm:py-1 bg-yellow-500 text-white rounded-md text-xs sm:text-sm hover:bg-yellow-600 transition duration-200"
                                >
                                    Sửa
                                </button>
                                <button
                                    onClick={() => onDeleteRoom(room)}
                                    className="px-2 py-1 sm:px-3 sm:py-1 bg-red-500 text-white rounded-md text-xs sm:text-sm hover:bg-red-600 transition duration-200"
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
        id: '', // Thêm id vào formData để xử lý cập nhật
        roomNumber: '',
        tenantName: '',
        idCard: '', // New field for CMND/CCCD
        address: '', // New field for Address
        hometown: '', // New field for Hometown
        phoneNumber: '',
        rentAmount: '',
        deposit: '',
        status: 'Vacant', // Default status
        startDate: '',
        // endDate: '', // Removed as per request
        previousElectricityMeter: '', // Chỉ số điện cũ của kỳ hiện tại
        currentElectricityMeter: '',  // Chỉ số điện mới của kỳ hiện tại
        previousWaterMeter: '',       // Chỉ số nước cũ của kỳ hiện tại
        currentWaterMeter: '',        // Chỉ số nước mới của kỳ hiện tại
        debtAmount: 0,                // Số tiền nợ
        debtDescription: '',          // Mô tả nợ
        dueDate: '',                  // Ngày đến hạn trả tiền (day of month)
        lastPaymentDate: '',          // Ngày thanh toán gần nhất
        condition: 'Tốt',             // Tình trạng phòng
        repairNotes: '',              // Ghi chú sửa chữa
        meterHistory: [],             // Lịch sử chỉ số điện nước
        notes: ''
    });

    useEffect(() => {
        if (room) {
            setFormData({
                id: room.id || '', // Đảm bảo id luôn được thiết lập
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
                // endDate: room.endDate || '', // Removed
                previousElectricityMeter: room.previousElectricityMeter || '',
                currentElectricityMeter: room.currentElectricityMeter || '',
                previousWaterMeter: room.previousWaterMeter || '',
                currentWaterMeter: room.currentWaterMeter || '',
                debtAmount: room.debtAmount || 0,
                debtDescription: room.debtDescription || '',
                dueDate: room.dueDate || '', // dueDate is now just a day (number)
                lastPaymentDate: room.lastPaymentDate || '',
                condition: room.condition || 'Tốt',
                repairNotes: room.repairNotes || '',
                meterHistory: room.meterHistory || [], // Load lịch sử chỉ số
                notes: room.notes || ''
            });
        }
    }, [room]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData); // Truyền formData trực tiếp, id đã có sẵn nếu là phòng hiện có
    };

    return (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md max-w-full md:max-w-2xl mx-auto">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">{room ? 'Chỉnh sửa Phòng' : 'Thêm Phòng Mới'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                <div>
                    <label htmlFor="roomNumber" className="block text-sm font-medium text-gray-700">Số phòng <span className="text-red-500">*</span></label>
                    <input
                        type="text"
                        id="roomNumber"
                        name="roomNumber"
                        value={formData.roomNumber}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="status" className="block text-sm font-medium text-gray-700">Trạng thái <span className="text-red-500">*</span></label>
                    <select
                        id="status"
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    >
                        <option value="Vacant">Trống</option>
                        <option value="Occupied">Đang thuê</option>
                        <option value="Maintenance">Bảo trì</option>
                    </select>
                </div>
                {formData.status === 'Occupied' && (
                    <>
                        <div>
                            <label htmlFor="tenantName" className="block text-sm font-medium text-gray-700">Tên người thuê</label>
                            <input
                                type="text"
                                id="tenantName"
                                name="tenantName"
                                value={formData.tenantName}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="idCard" className="block text-sm font-medium text-gray-700">Số CMND/CCCD</label>
                            <input
                                type="text"
                                id="idCard"
                                name="idCard"
                                value={formData.idCard}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="address" className="block text-sm font-medium text-gray-700">Địa chỉ</label>
                            <input
                                type="text"
                                id="address"
                                name="address"
                                value={formData.address}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="hometown" className="block text-sm font-medium text-gray-700">Quê quán</label>
                            <input
                                type="text"
                                id="hometown"
                                name="hometown"
                                value={formData.hometown}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700">Số điện thoại</label>
                            <input
                                type="text"
                                id="phoneNumber"
                                name="phoneNumber"
                                value={formData.phoneNumber}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="rentAmount" className="block text-sm font-medium text-gray-700">Giá thuê (VNĐ)</label>
                            <input
                                type="number"
                                id="rentAmount"
                                name="rentAmount"
                                value={formData.rentAmount}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="deposit" className="block text-sm font-medium text-gray-700">Tiền đặt cọc (VNĐ)</label>
                            <input
                                type="number"
                                id="deposit"
                                name="deposit"
                                value={formData.deposit}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">Ngày bắt đầu thuê</label>
                            <input
                                type="date"
                                id="startDate"
                                name="startDate"
                                value={formData.startDate}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        {/* Removed endDate as per request */}
                        <div>
                            <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">Ngày đến hạn trả tiền (ngày trong tháng)</label>
                            <input
                                type="number" // Changed to number for day of month
                                id="dueDate"
                                name="dueDate"
                                value={formData.dueDate}
                                onChange={handleChange}
                                min="1"
                                max="31"
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="lastPaymentDate" className="block text-sm font-medium text-gray-700">Ngày thanh toán gần nhất</label>
                            <input
                                type="date"
                                id="lastPaymentDate"
                                name="lastPaymentDate"
                                value={formData.lastPaymentDate}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="previousElectricityMeter" className="block text-sm font-medium text-gray-700">Chỉ số điện cũ (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="previousElectricityMeter"
                                name="previousElectricityMeter"
                                value={formData.previousElectricityMeter}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="currentElectricityMeter" className="block text-sm font-medium text-gray-700">Chỉ số điện mới (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="currentElectricityMeter"
                                name="currentElectricityMeter"
                                value={formData.currentElectricityMeter}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="previousWaterMeter" className="block text-sm font-medium text-gray-700">Chỉ số nước cũ (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="previousWaterMeter"
                                name="previousWaterMeter"
                                value={formData.previousWaterMeter}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="currentWaterMeter" className="block text-sm font-medium text-gray-700">Chỉ số nước mới (kỳ hiện tại)</label>
                            <input
                                type="number"
                                id="currentWaterMeter"
                                name="currentWaterMeter"
                                value={formData.currentWaterMeter}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="debtAmount" className="block text-sm font-medium text-gray-700">Số tiền nợ (VNĐ)</label>
                            <input
                                type="number"
                                id="debtAmount"
                                name="debtAmount"
                                value={formData.debtAmount}
                                onChange={handleChange}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="debtDescription" className="block text-sm font-medium text-gray-700">Mô tả nợ</label>
                            <textarea
                                id="debtDescription"
                                name="debtDescription"
                                value={formData.debtDescription}
                                onChange={handleChange}
                                rows="2"
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            ></textarea>
                        </div>
                    </>
                )}
                <div>
                    <label htmlFor="condition" className="block text-sm font-medium text-gray-700">Tình trạng phòng</label>
                    <select
                        id="condition"
                        name="condition"
                        value={formData.condition}
                        onChange={handleChange}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    >
                        <option value="Tốt">Tốt</option>
                        <option value="Cần sửa chữa">Cần sửa chữa</option>
                        <option value="Đang sửa chữa">Đang sửa chữa</option>
                    </select>
                </div>
                {formData.condition !== 'Tốt' && (
                    <div>
                        <label htmlFor="repairNotes" className="block text-sm font-medium text-gray-700">Ghi chú sửa chữa</label>
                        <textarea
                            id="repairNotes"
                            name="repairNotes"
                            value={formData.repairNotes}
                            onChange={handleChange}
                            rows="2"
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                        ></textarea>
                    </div>
                )}
                <div>
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700">Ghi chú chung</label>
                    <textarea
                        id="notes"
                        name="notes"
                        value={formData.notes}
                        onChange={handleChange}
                        rows="3"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    ></textarea>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition duration-200 text-sm sm:text-base"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200 text-sm sm:text-base"
                    >
                        {room ? 'Cập nhật' : 'Thêm Phòng'}
                    </button>
                </div>
            </form>
        </div>
    );
};

// Component Modal chi tiết phòng
const RoomDetailModal = ({ room, onClose, onEdit, onDelete }) => {
    if (!room) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-4 sm:p-6 max-w-full sm:max-w-lg w-full mx-auto overflow-y-auto max-h-[90vh]">
                <div className="flex justify-between items-center mb-3 sm:mb-4">
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-800">Chi tiết Phòng {room.roomNumber}</h3>
                    <button
                        onClick={onClose}
                        className="text-2xl sm:text-3xl text-gray-500 hover:text-gray-700"
                    >
                        &times;
                    </button>
                </div>
                <div className="space-y-2 sm:space-y-3 text-sm sm:text-base text-gray-700 mb-4 sm:mb-6">
                    <p><strong>Trạng thái:</strong> <span className={`font-semibold ${room.status === 'Occupied' ? 'text-red-600' : room.status === 'Vacant' ? 'text-green-600' : 'text-yellow-600'}`}>{room.status === 'Occupied' ? 'Đang thuê' : room.status === 'Vacant' ? 'Trống' : 'Bảo trì'}</span></p>
                    {room.tenantName && <p><strong>Người thuê:</strong> {room.tenantName}</p>}
                    {room.idCard && <p><strong>Số CMND/CCCD:</strong> {room.idCard}</p>}
                    {room.address && <p><strong>Địa chỉ:</strong> {room.address}</p>}
                    {room.hometown && <p><strong>Quê quán:</strong> {room.hometown}</p>}
                    {room.phoneNumber && <p><strong>Số điện thoại:</strong> {room.phoneNumber}</p>}
                    {room.rentAmount && <p><strong>Giá thuê:</strong> {parseInt(room.rentAmount).toLocaleString('vi-VN')} VNĐ</p>}
                    {room.deposit && <p><strong>Tiền đặt cọc:</strong> {parseInt(room.deposit).toLocaleString('vi-VN')} VNĐ</p>}
                    {room.startDate && <p><strong>Ngày bắt đầu:</strong> {formatDisplayDate(room.startDate)}</p>}
                    {/* Removed endDate display */}
                    {room.dueDate && <p><strong>Ngày đến hạn:</strong> ngày {room.dueDate} hàng tháng</p>}
                    {room.lastPaymentDate && <p><strong>Ngày thanh toán gần nhất:</strong> {formatDisplayDate(room.lastPaymentDate)}</p>}
                    <p><strong>Chỉ số điện cũ (kỳ hiện tại):</strong> {room.previousElectricityMeter || 'N/A'}</p>
                    <p><strong>Chỉ số điện mới (kỳ hiện tại):</strong> {room.currentElectricityMeter || 'N/A'}</p>
                    <p><strong>Chỉ số nước cũ (kỳ hiện tại):</strong> {room.previousWaterMeter || 'N/A'}</p>
                    <p><strong>Chỉ số nước mới (kỳ hiện tại):</strong> {room.currentWaterMeter || 'N/A'}</p>
                    {room.debtAmount > 0 && <p className="text-red-600 font-semibold"><strong>Số tiền nợ:</strong> {parseInt(room.debtAmount).toLocaleString('vi-VN')} VNĐ</p>}
                    {room.debtDescription && <p><strong>Mô tả nợ:</strong> {room.debtDescription}</p>}
                    <p><strong>Tình trạng phòng:</strong> <span className={`font-semibold ${room.condition === 'Tốt' ? 'text-green-600' : 'text-red-600'}`}>{room.condition}</span></p>
                    {room.repairNotes && <p><strong>Ghi chú sửa chữa:</strong> {room.repairNotes}</p>}
                    {room.notes && <p><strong>Ghi chú chung:</strong> {room.notes}</p>}

                    {room.meterHistory && room.meterHistory.length > 0 && (
                        <div className="mt-3 sm:mt-4 border-t pt-3 sm:pt-4">
                            <h4 className="text-base sm:text-lg font-semibold text-gray-800 mb-1 sm:mb-2">Lịch sử chỉ số 3 tháng gần nhất:</h4>
                            {room.meterHistory.map((entry, index) => (
                                <div key={index} className="mb-1 p-1 sm:mb-2 sm:p-2 bg-gray-50 rounded-md text-xs sm:text-sm">
                                    <p><strong>Kỳ:</strong> Tháng {entry.month}</p>
                                    <p>Điện: Cũ {entry.electricityOld} - Mới {entry.electricityNew}</p>
                                    <p>Nước: Cũ {entry.waterOld} - Mới {entry.waterNew}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex justify-end space-x-2 sm:space-x-3">
                    <button
                        onClick={() => { onEdit(room); }}
                        className="px-3 py-1 sm:px-4 sm:py-2 bg-yellow-500 text-white rounded-md text-sm sm:text-base hover:bg-yellow-600 transition duration-200"
                    >
                        Sửa
                    </button>
                    <button
                        onClick={() => { onDelete(room); onClose(); }} // Đóng modal chi tiết sau khi xác nhận xóa
                        className="px-3 py-1 sm:px-4 sm:py-2 bg-red-500 text-white rounded-md text-sm sm:text-base hover:bg-red-600 transition duration-200"
                    >
                        Xóa
                    </button>
                    <button
                        onClick={onClose}
                        className="px-3 py-1 sm:px-4 sm:py-2 bg-gray-200 text-gray-800 rounded-md text-sm sm:text-base hover:bg-gray-300 transition duration-200"
                    >
                        Đóng
                    </button>
                </div>
            </div>
        </div>
    );
};

// Component Cài đặt Dịch vụ
const ServiceSettingsForm = ({ settings, onSave }) => {
    const [formData, setFormData] = useState(settings);

    useEffect(() => {
        setFormData(settings);
    }, [settings]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md max-w-full md:max-w-xl mx-auto">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Cài đặt Dịch vụ</h2>
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                <div>
                    <label htmlFor="electricityPrice" className="block text-sm font-medium text-gray-700">Giá điện (VNĐ/kWh)</label>
                    <input
                        type="number"
                        id="electricityPrice"
                        name="electricityPrice"
                        value={formData.electricityPrice}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="waterPrice" className="block text-sm font-medium text-gray-700">Giá nước (VNĐ/m³)</label>
                    <input
                        type="number"
                        id="waterPrice"
                        name="waterPrice"
                        value={formData.waterPrice}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="internetPrice" className="block text-sm font-medium text-gray-700">Giá Internet (VNĐ/tháng)</label>
                    <input
                        type="number"
                        id="internetPrice"
                        name="internetPrice"
                        value={formData.internetPrice}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="trashPrice" className="block text-sm font-medium text-gray-700">Giá rác (VNĐ/tháng)</label>
                    <input
                        type="number"
                        id="trashPrice"
                        name="trashPrice"
                        value={formData.trashPrice}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div className="flex justify-end mt-4 sm:mt-6">
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200 text-sm sm:text-base"
                    >
                        Lưu Cài đặt
                    </button>
                </div>
            </form>
        </div>
    );
};

// Component Tính Tiền Phòng
const BillGenerator = ({ rooms, serviceSettings, db, userId, appId, setModalMessage, setModalTitle, setShowCancelModal, setModalAction }) => {
    const [selectedRoomId, setSelectedRoomId] = useState('');
    const [billingMonth, setBillingMonth] = useState(new Date().getMonth() + 1);
    const [billingYear, setBillingYear] = useState(new Date().getFullYear());
    const [calculatedBill, setCalculatedBill] = useState(null);
    const [otherFeesDescription, setOtherFeesDescription] = useState('');
    const [otherFeesAmount, setOtherFeesAmount] = useState(0);
    const [currentRoomData, setCurrentRoomData] = useState(null); // State để lưu thông tin phòng được chọn
    const [tempElectricityMeter, setTempElectricityMeter] = useState({ previous: '', current: '' });
    const [tempWaterMeter, setTempWaterMeter] = useState({ previous: '', current: '' });


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
        if (!selectedRoomId || !serviceSettings || !currentRoomData) {
            setModalTitle("Lỗi");
            setModalMessage("Vui lòng chọn phòng và đảm bảo cài đặt dịch vụ đã được tải.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }

        // Use temp meter readings for calculation
        const electricityUsage = (parseFloat(tempElectricityMeter.current) || 0) - (parseFloat(tempElectricityMeter.previous) || 0);
        const electricityCost = electricityUsage > 0 ? electricityUsage * serviceSettings.electricityPrice : 0;

        const waterUsage = (parseFloat(tempWaterMeter.current) || 0) - (parseFloat(tempWaterMeter.previous) || 0);
        const waterCost = waterUsage > 0 ? waterUsage * serviceSettings.waterPrice : 0;

        const currentMonthCharges =
            (parseInt(currentRoomData.rentAmount) || 0) +
            electricityCost +
            waterCost +
            (parseInt(serviceSettings.internetPrice) || 0) +
            (parseInt(serviceSettings.trashPrice) || 0) +
            (parseInt(otherFeesAmount) || 0);

        // Fetch outstanding debt from the room's current state
        const outstandingPreviousDebt = parseInt(currentRoomData.debtAmount) || 0;

        // Sửa lỗi: Đảm bảo các giá trị được cộng là số
        const totalAmount = currentMonthCharges + outstandingPreviousDebt;

        const billDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const invoiceCode = `${currentRoomData.roomNumber}-${formatInvoiceDate(billDate)}`;

        setCalculatedBill({
            roomId: currentRoomData.id,
            roomNumber: currentRoomData.roomNumber,
            tenantName: currentRoomData.tenantName,
            billingMonth: billingMonth,
            billingYear: billingYear,
            rentAmount: parseInt(currentRoomData.rentAmount || 0),
            previousElectricityMeter: parseFloat(tempElectricityMeter.previous) || 0,
            currentElectricityMeter: parseFloat(tempElectricityMeter.current) || 0,
            electricityUsage: electricityUsage,
            electricityCost: electricityCost,
            previousWaterMeter: parseFloat(tempWaterMeter.previous) || 0,
            currentWaterMeter: parseFloat(tempWaterMeter.current) || 0,
            waterUsage: waterUsage,
            waterCost: waterCost,
            internetFee: parseInt(serviceSettings.internetPrice || 0),
            trashFee: parseInt(serviceSettings.trashPrice || 0),
            otherFeesDescription: otherFeesDescription,
            otherFeesAmount: parseInt(otherFeesAmount || 0),
            currentMonthCharges: currentMonthCharges, // New field for current month's charges
            outstandingPreviousDebt: outstandingPreviousDebt, // New field for previous debt
            totalAmount: totalAmount,
            paymentStatus: 'Unpaid', // Default to Unpaid
            paidAmount: 0, // Default paid amount
            remainingAmount: totalAmount, // Initially, remaining is total
            billDate: billDate, // YYYY-MM-DD
            invoiceCode: invoiceCode // New field for invoice code
        });
    };

    const handleSaveBill = async () => {
        if (!calculatedBill) {
            setModalTitle("Lỗi");
            setModalMessage("Chưa có hóa đơn để lưu.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }

        if (!db || !userId) {
            setModalTitle("Lỗi");
            setModalMessage("Ứng dụng chưa sẵn sàng. Vui lòng thử lại sau.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }

        try {
            const billsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/bills`);
            await addDoc(billsCollectionRef, calculatedBill);

            // Cập nhật chỉ số điện nước cũ của phòng thành chỉ số mới sau khi tạo hóa đơn
            const roomRef = doc(collection(db, `artifacts/${appId}/users/${userId}/rooms`), calculatedBill.roomId);

            // Cập nhật lịch sử chỉ số điện nước
            const roomSnap = await getDoc(roomRef);
            const existingRoomData = roomSnap.data();
            let updatedMeterHistory = existingRoomData.meterHistory || [];

            // Thêm chỉ số của kỳ vừa tính vào lịch sử
            updatedMeterHistory.unshift({
                month: `${calculatedBill.billingMonth}/${calculatedBill.billingYear}`,
                electricityOld: calculatedBill.previousElectricityMeter,
                electricityNew: calculatedBill.currentElectricityMeter,
                waterOld: calculatedBill.previousWaterMeter,
                waterNew: calculatedBill.currentWaterMeter,
            });

            // Giữ lại tối đa 3 tháng gần nhất
            if (updatedMeterHistory.length > 3) {
                updatedMeterHistory = updatedMeterHistory.slice(0, 3);
            }

            await updateDoc(roomRef, {
                previousElectricityMeter: calculatedBill.currentElectricityMeter, // Chỉ số mới của kỳ này thành cũ của kỳ sau
                currentElectricityMeter: 0, // Reset chỉ số mới
                previousWaterMeter: calculatedBill.currentWaterMeter, // Chỉ số mới của kỳ này thành cũ của kỳ sau
                currentWaterMeter: 0, // Reset chỉ số mới
                debtAmount: calculatedBill.totalAmount, // Tổng nợ của phòng là tổng hóa đơn mới
                debtDescription: calculatedBill.otherFeesDescription || '', // Mô tả nợ
                meterHistory: updatedMeterHistory // Cập nhật lịch sử chỉ số
            });

            setModalTitle("Thành công");
            setModalMessage("Hóa đơn đã được lưu và chỉ số điện nước của phòng đã được cập nhật cho kỳ tiếp theo!");
            setShowCancelModal(false);
            setModalAction(() => () => {
                setModalMessage('');
                setCalculatedBill(null);
                setOtherFeesDescription('');
                setOtherFeesAmount(0);
                setSelectedRoomId(''); // Reset selected room
            });
        } catch (error) {
            console.error("Lỗi khi lưu hóa đơn:", error);
            setModalTitle("Lỗi");
            setModalMessage(`Không thể lưu hóa đơn: ${error.message}`);
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
        }
    };

    return (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md max-w-full md:max-w-3xl mx-auto">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Tính Tiền Phòng</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div>
                    <label htmlFor="selectRoom" className="block text-sm font-medium text-gray-700">Chọn Phòng</label>
                    <select
                        id="selectRoom"
                        value={selectedRoomId}
                        onChange={(e) => setSelectedRoomId(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    >
                        <option value="">-- Chọn phòng --</option>
                        {rooms.map(room => (
                            <option key={room.id} value={room.id}>Phòng {room.roomNumber} ({room.tenantName || 'Trống'})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="billingMonth" className="block text-sm font-medium text-gray-700">Tháng</label>
                    <input
                        type="number"
                        id="billingMonth"
                        value={billingMonth}
                        onChange={(e) => setBillingMonth(parseInt(e.target.value))}
                        min="1"
                        max="12"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="billingYear" className="block text-sm font-medium text-gray-700">Năm</label>
                    <input
                        type="number"
                        id="billingYear"
                        value={billingYear}
                        onChange={(e) => setBillingYear(parseInt(e.target.value))}
                        min="2000"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
            </div>

            {currentRoomData && (
                <div className="bg-blue-50 p-4 rounded-lg shadow-sm mb-4 sm:mb-6">
                    <h3 className="text-lg sm:text-xl font-bold text-blue-800 mb-3 sm:mb-4">Thông tin Phòng {currentRoomData.roomNumber}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-sm sm:text-base text-gray-700">
                        <p><strong>Người thuê:</strong> {currentRoomData.tenantName || 'N/A'}</p>
                        <p><strong>Giá thuê:</strong> {parseInt(currentRoomData.rentAmount).toLocaleString('vi-VN')} VNĐ</p>
                        <p><strong>Số điện thoại:</strong> {currentRoomData.phoneNumber || 'N/A'}</p>
                        <p><strong>Ngày đến hạn:</strong> ngày {currentRoomData.dueDate || 'N/A'} hàng tháng</p>
                        <p><strong>Nợ hiện tại:</strong> <span className="text-red-600 font-semibold">{parseInt(currentRoomData.debtAmount).toLocaleString('vi-VN')} VNĐ</span></p>
                        <p><strong>Mô tả nợ:</strong> {currentRoomData.debtDescription || 'Không có'}</p>
                    </div>
                    <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                            <label htmlFor="tempPreviousElectricityMeter" className="block text-sm font-medium text-gray-700">Chỉ số điện cũ</label>
                            <input
                                type="number"
                                id="tempPreviousElectricityMeter"
                                value={tempElectricityMeter.previous}
                                onChange={(e) => setTempElectricityMeter(prev => ({ ...prev, previous: e.target.value }))}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="tempCurrentElectricityMeter" className="block text-sm font-medium text-gray-700">Chỉ số điện mới</label>
                            <input
                                type="number"
                                id="tempCurrentElectricityMeter"
                                value={tempElectricityMeter.current}
                                onChange={(e) => setTempElectricityMeter(prev => ({ ...prev, current: e.target.value }))}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="tempPreviousWaterMeter" className="block text-sm font-medium text-gray-700">Chỉ số nước cũ</label>
                            <input
                                type="number"
                                id="tempPreviousWaterMeter"
                                value={tempWaterMeter.previous}
                                onChange={(e) => setTempWaterMeter(prev => ({ ...prev, previous: e.target.value }))}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                        <div>
                            <label htmlFor="tempCurrentWaterMeter" className="block text-sm font-medium text-gray-700">Chỉ số nước mới</label>
                            <input
                                type="number"
                                id="tempCurrentWaterMeter"
                                value={tempWaterMeter.current}
                                onChange={(e) => setTempWaterMeter(prev => ({ ...prev, current: e.target.value }))}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                            />
                        </div>
                    </div>
                    {currentRoomData.meterHistory && currentRoomData.meterHistory.length > 0 && (
                        <div className="mt-3 sm:mt-4 border-t pt-3 sm:pt-4">
                            <h4 className="text-base sm:text-lg font-semibold text-gray-800 mb-1 sm:mb-2">Lịch sử chỉ số 3 tháng gần nhất:</h4>
                            {currentRoomData.meterHistory.map((entry, index) => (
                                <div key={index} className="mb-1 p-1 sm:mb-2 sm:p-2 bg-gray-100 rounded-md text-xs sm:text-sm">
                                    <p><strong>Kỳ:</strong> Tháng {entry.month}</p>
                                    <p>Điện: Cũ {entry.electricityOld} - Mới {entry.electricityNew}</p>
                                    <p>Nước: Cũ {entry.waterOld} - Mới {entry.waterNew}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
                <div>
                    <label htmlFor="otherFeesDescription" className="block text-sm font-medium text-gray-700">Mô tả phí khác (nếu có)</label>
                    <input
                        type="text"
                        id="otherFeesDescription"
                        value={otherFeesDescription}
                        onChange={(e) => setOtherFeesDescription(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="otherFeesAmount" className="block text-sm font-medium text-gray-700">Số tiền phí khác (VNĐ)</label>
                    <input
                        type="number"
                        id="otherFeesAmount"
                        value={otherFeesAmount}
                        onChange={(e) => setOtherFeesAmount(parseFloat(e.target.value) || 0)}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
            </div>

            <div className="flex justify-end mb-4 sm:mb-6">
                <button
                    onClick={handleGenerateBill}
                    className="px-5 py-2 sm:px-6 sm:py-2 bg-green-600 text-white rounded-md text-sm sm:text-base hover:bg-green-700 transition duration-200"
                >
                    Tạo Hóa đơn
                </button>
            </div>

            {calculatedBill && (
                <div className="border border-gray-300 rounded-lg p-4 sm:p-6 bg-blue-50">
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4">Hóa đơn Tiền Phòng - Tháng {calculatedBill.billingMonth}/{calculatedBill.billingYear}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-sm sm:text-base text-gray-700">
                        <p><strong>Phòng:</strong> {calculatedBill.roomNumber}</p>
                        <p><strong>Người thuê:</strong> {calculatedBill.tenantName}</p>
                        <p><strong>Tiền phòng tháng này:</strong> {calculatedBill.rentAmount.toLocaleString('vi-VN')} VNĐ</p>
                        <div>
                            <p><strong>Điện:</strong></p>
                            <ul className="list-disc list-inside ml-4">
                                <li>Chỉ số cũ: {calculatedBill.previousElectricityMeter}</li>
                                <li>Chỉ số mới: {calculatedBill.currentElectricityMeter}</li>
                                <li>Sử dụng: {calculatedBill.electricityUsage} kWh</li>
                                <li>Thành tiền: {calculatedBill.electricityCost.toLocaleString('vi-VN')} VNĐ</li>
                            </ul>
                        </div>
                        <div>
                            <p><strong>Nước:</strong></p>
                            <ul className="list-disc list-inside ml-4">
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
                        <p className="col-span-2"><strong>Các khoản tháng này:</strong> {calculatedBill.currentMonthCharges.toLocaleString('vi-VN')} VNĐ</p>
                        <p className="col-span-2 text-red-600 font-semibold"><strong>Nợ cũ còn lại:</strong> {calculatedBill.outstandingPreviousDebt.toLocaleString('vi-VN')} VNĐ</p>
                    </div>
                    <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-300 text-right">
                        <p className="text-xl sm:text-2xl font-bold text-blue-800">Tổng cộng phải trả: {calculatedBill.totalAmount.toLocaleString('vi-VN')} VNĐ</p>
                    </div>
                    <div className="flex justify-end space-x-3 mt-4 sm:mt-6">
                        <button
                            onClick={handleSaveBill}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200 text-sm sm:text-base"
                        >
                            Lưu Hóa đơn
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Component Lịch sử Hóa đơn
const BillHistory = ({ bills, rooms, onOpenPaymentModal, onOpenBillDetailModal, setModalMessage, setModalTitle, setShowCancelModal, setModalAction }) => {
    const [filterRoomId, setFilterRoomId] = useState('');
    const [filterMonth, setFilterMonth] = useState('');
    const [filterYear, setFilterYear] = useState('');
    const [filterStatus, setFilterStatus] = useState(''); // New filter for payment status

    const filteredBills = bills.filter(bill => {
        const matchesRoom = filterRoomId ? bill.roomId === filterRoomId : true;
        const matchesMonth = filterMonth ? bill.billingMonth === parseInt(filterMonth) : true;
        const matchesYear = filterYear ? bill.billingYear === parseInt(filterYear) : true;
        const matchesStatus = filterStatus ? bill.paymentStatus === filterStatus : true;
        return matchesRoom && matchesMonth && matchesYear && matchesStatus;
    });

    const getRoomNumber = (roomId) => {
        const room = rooms.find(r => r.id === roomId);
        return room ? room.roomNumber : 'N/A';
    };

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
            case 'Paid': return 'bg-green-100 text-green-800';
            case 'Unpaid': return 'bg-red-100 text-red-800';
            case 'Partially Paid': return 'bg-yellow-100 text-yellow-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    return (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Lịch sử Hóa đơn</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div>
                    <label htmlFor="filterRoom" className="block text-sm font-medium text-gray-700">Lọc theo Phòng</label>
                    <select
                        id="filterRoom"
                        value={filterRoomId}
                        onChange={(e) => setFilterRoomId(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    >
                        <option value="">Tất cả phòng</option>
                        {rooms.map(room => (
                            <option key={room.id} value={room.id}>Phòng {room.roomNumber}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="filterMonth" className="block text-sm font-medium text-gray-700">Lọc theo Tháng</label>
                    <input
                        type="number"
                        id="filterMonth"
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        min="1"
                        max="12"
                        placeholder="Tháng"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="filterYear" className="block text-sm font-medium text-gray-700">Lọc theo Năm</label>
                    <input
                        type="number"
                        id="filterYear"
                        value={filterYear}
                        onChange={(e) => setFilterYear(parseInt(e.target.value))}
                        min="2000"
                        placeholder="Năm"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="filterStatus" className="block text-sm font-medium text-gray-700">Lọc theo Trạng thái</label>
                    <select
                        id="filterStatus"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    >
                        <option value="">Tất cả</option>
                        <option value="Unpaid">Chưa thanh toán</option>
                        <option value="Partially Paid">Thanh toán một phần</option>
                        <option value="Paid">Đã thanh toán</option>
                    </select>
                </div>
            </div>

            {filteredBills.length === 0 ? (
                <p className="text-sm sm:text-base text-gray-600">Không có hóa đơn nào phù hợp với bộ lọc.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white border border-gray-200 rounded-lg text-sm sm:text-base">
                        <thead>
                            <tr className="bg-gray-100 text-left text-xs sm:text-sm font-semibold text-gray-700 border-b border-gray-200">
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Mã số HĐ</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Phòng</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Người thuê</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Kỳ</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Tổng tiền HĐ</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Nợ cũ HĐ</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Đã TT HĐ</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Còn lại HĐ</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Trạng thái</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Ngày tạo</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Ngày TT</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Hành động</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredBills.map(bill => (
                                <tr key={bill.id} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">
                                        <button
                                            onClick={() => onOpenBillDetailModal(bill)}
                                            className="text-blue-600 hover:underline font-semibold"
                                        >
                                            {bill.invoiceCode}
                                        </button>
                                    </td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{getRoomNumber(bill.roomId)}</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{bill.tenantName}</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">Tháng {bill.billingMonth}/{bill.billingYear}</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{bill.totalAmount.toLocaleString('vi-VN')} VNĐ</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4 text-red-600 font-semibold">{(bill.outstandingPreviousDebt || 0).toLocaleString('vi-VN')} VNĐ</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{(bill.paidAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4 text-red-600 font-semibold">{(bill.remainingAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">
                                        <span className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs sm:text-xs font-semibold ${getPaymentStatusColor(bill.paymentStatus)}`}>
                                            {getPaymentStatusText(bill.paymentStatus)}
                                        </span>
                                    </td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{formatDisplayDate(bill.billDate)}</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{bill.paymentDate ? formatDisplayDate(bill.paymentDate) : 'N/A'}</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">
                                        {bill.paymentStatus !== 'Paid' && (
                                            <button
                                                onClick={() => onOpenPaymentModal(bill)}
                                                className="px-2 py-1 bg-green-500 text-white rounded-md text-xs sm:text-sm hover:bg-green-600 transition duration-200"
                                            >
                                                Thanh toán
                                            </button>
                                        )}
                                        {bill.paymentStatus === 'Paid' && (
                                            <button
                                                className="px-2 py-1 bg-gray-300 text-gray-600 rounded-md text-xs sm:text-sm cursor-not-allowed"
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
const ExpenseManagement = ({ expenses, onAddExpense, onDeleteExpense, setModalMessage, setModalTitle, setShowCancelModal, setModalAction }) => {
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!description || !amount) {
            setModalTitle("Lỗi");
            setModalMessage("Vui lòng nhập mô tả và số tiền chi phí.");
            setShowCancelModal(false);
            setModalAction(() => () => setModalMessage(''));
            return;
        }
        onAddExpense({
            description,
            amount: parseFloat(amount),
            date
        });
        setDescription('');
        setAmount('');
        setDate(new Date().toISOString().split('T')[0]);
    };

    return (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md max-w-full md:max-w-3xl mx-auto">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Quản lý Chi phí</h2>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div>
                    <label htmlFor="expenseDescription" className="block text-sm font-medium text-gray-700">Mô tả chi phí</label>
                    <input
                        type="text"
                        id="expenseDescription"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="expenseAmount" className="block text-sm font-medium text-gray-700">Số tiền (VNĐ)</label>
                    <input
                        type="number"
                        id="expenseAmount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                        min="0"
                        step="1000"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="expenseDate" className="block text-sm font-medium text-gray-700">Ngày</label>
                    <input
                        type="date"
                        id="expenseDate"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div className="md:col-span-3 flex justify-end">
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200 text-sm sm:text-base"
                    >
                        Thêm Chi phí
                    </button>
                </div>
            </form>

            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-3 sm:mb-4">Danh sách Chi phí</h3>
            {expenses.length === 0 ? (
                <p className="text-sm sm:text-base text-gray-600">Chưa có chi phí nào được ghi nhận.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white border border-gray-200 rounded-lg text-sm sm:text-base">
                        <thead>
                            <tr className="bg-gray-100 text-left text-xs sm:text-sm font-semibold text-gray-700 border-b border-gray-200">
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Mô tả</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Số tiền</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Ngày</th>
                                <th className="py-2 px-3 sm:py-3 sm:px-4">Hành động</th>
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.map(expense => (
                                <tr key={expense.id} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{expense.description}</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{expense.amount.toLocaleString('vi-VN')} VNĐ</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">{formatDisplayDate(expense.date)}</td>
                                    <td className="py-2 px-3 sm:py-3 sm:px-4">
                                        <button
                                            onClick={() => onDeleteExpense(expense.id)}
                                            className="px-2 py-1 bg-red-500 text-white rounded-md text-xs sm:text-sm hover:bg-red-600 transition duration-200"
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

    const filteredBills = bills.filter(bill => {
        const matchesMonth = filterMonth ? bill.billingMonth === parseInt(filterMonth) : true;
        const matchesYear = filterYear ? bill.billingYear === parseInt(filterYear) : true;
        return matchesMonth && matchesYear;
    });

    const filteredExpenses = expenses.filter(expense => {
        const expenseDate = new Date(expense.date);
        const matchesMonth = filterMonth ? (expenseDate.getMonth() + 1) === parseInt(filterMonth) : true;
        const matchesYear = filterYear ? expenseDate.getFullYear() === parseInt(filterYear) : true;
        return matchesMonth && matchesYear;
    });

    const totalIncome = filteredBills.reduce((sum, bill) => sum + (bill.paidAmount || 0), 0);
    const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
    const netBalance = totalIncome - totalExpenses;

    return (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md max-w-full md:max-w-2xl mx-auto">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Tổng quan Tài chính</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div>
                    <label htmlFor="filterMonthOverview" className="block text-sm font-medium text-gray-700">Lọc theo Tháng</label>
                    <input
                        type="number"
                        id="filterMonthOverview"
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        min="1"
                        max="12"
                        placeholder="Tháng"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
                <div>
                    <label htmlFor="filterYearOverview" className="block text-sm font-medium text-gray-700">Lọc theo Năm</label>
                    <input
                        type="number"
                        id="filterYearOverview"
                        value={filterYear}
                        onChange={(e) => setFilterYear(parseInt(e.target.value))}
                        min="2000"
                        placeholder="Năm"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                    />
                </div>
            </div>

            <div className="space-y-3 sm:space-y-4 text-sm sm:text-base text-gray-700">
                <div className="flex justify-between items-center p-3 bg-green-50 rounded-md">
                    <p className="font-semibold text-base sm:text-lg">Tổng thu:</p>
                    <p className="text-green-600 font-bold text-lg sm:text-xl">{totalIncome.toLocaleString('vi-VN')} VNĐ</p>
                </div>
                <div className="flex justify-between items-center p-3 bg-red-50 rounded-md">
                    <p className="font-semibold text-base sm:text-lg">Tổng chi phí:</p>
                    <p className="text-red-600 font-bold text-lg sm:text-xl">{totalExpenses.toLocaleString('vi-VN')} VNĐ</p>
                </div>
                <div className={`flex justify-between items-center p-3 rounded-md ${netBalance >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
                    <p className="font-semibold text-base sm:text-lg">Số dư ròng:</p>
                    <p className={`font-bold text-lg sm:text-xl ${netBalance >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                        {netBalance.toLocaleString('vi-VN')} VNĐ
                    </p>
                </div>
            </div>

            <div className="mt-6 sm:mt-8">
                <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-3 sm:mb-4">Phân tích nợ phòng</h3>
                {bills.filter(bill => bill.remainingAmount > 0).length === 0 ? (
                    <p className="text-sm sm:text-base text-gray-600">Không có hóa đơn nào đang nợ.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white border border-gray-200 rounded-lg text-sm sm:text-base">
                            <thead>
                                <tr className="bg-gray-100 text-left text-xs sm:text-sm font-semibold text-gray-700 border-b border-gray-200">
                                    <th className="py-2 px-3 sm:py-3 sm:px-4">Phòng</th>
                                    <th className="py-2 px-3 sm:py-3 sm:px-4">Kỳ</th>
                                    <th className="py-2 px-3 sm:py-3 sm:px-4">Tổng tiền HĐ</th>
                                    <th className="py-2 px-3 sm:py-3 sm:px-4">Đã TT HĐ</th>
                                    <th className="py-2 px-3 sm:py-3 sm:px-4">Còn lại HĐ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bills.filter(bill => bill.remainingAmount > 0).map(bill => (
                                    <tr key={bill.id} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
                                        <td className="py-2 px-3 sm:py-3 sm:px-4">{bill.roomNumber}</td>
                                        <td className="py-2 px-3 sm:py-3 sm:px-4">Tháng {bill.billingMonth}/{bill.billingYear}</td>
                                        <td className="py-2 px-3 sm:py-3 sm:px-4">{bill.totalAmount.toLocaleString('vi-VN')} VNĐ</td>
                                        <td className="py-2 px-3 sm:py-3 sm:px-4">{(bill.paidAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
                                        <td className="py-2 px-3 sm:py-3 sm:px-4 text-red-600 font-semibold">{(bill.remainingAmount || 0).toLocaleString('vi-VN')} VNĐ</td>
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
